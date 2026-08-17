// @vitest-environment node

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppSessionToken } from './app-session-token';
import { APP_PERMISSIONS } from './app-permissions';
import { installFmaEndpoints } from './fma-http-endpoint';
import type { ApplicationLogger } from './logging/log-contracts';

const ENV = {
  DATASUL_BASE_URL: 'https://datasul.example.test',
  DATASUL_COMPANY_ID: '1',
  DATASUL_INTEGRATION_USER: 'integracao',
  DATASUL_INTEGRATION_PASSWORD: 'segredo-tecnico',
  DATASUL_REQUEST_TIMEOUT_MS: '1000',
  APP_AUTH_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
};

type RunningServer = ReturnType<ReturnType<typeof express>['listen']>;
const servers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    if (!server.listening) { resolve(); return; }
    server.close(error => error ? reject(error) : resolve());
  })));
});

async function token(permissions: readonly string[] = [APP_PERMISSIONS.operationReporting]): Promise<string> {
  return (await createAppSessionToken({
    subject: 'mjocelio', permissions, secret: ENV.APP_AUTH_TOKEN_SECRET,
    ttlMs: 60_000, now: new Date(),
  })).token;
}

async function startGateway(transport: typeof fetch, logger?: ApplicationLogger): Promise<string> {
  const app = express();
  installFmaEndpoints(app, { env: ENV, transport, logger });
  let server!: RunningServer;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function logSink() {
  const events: Array<{ level: string; event: string; metadata?: Record<string, unknown> }> = [];
  const write = (level: string) => (event: string, metadata?: Record<string, unknown>) => {
    events.push({ level, event, metadata });
  };
  return {
    events,
    logger: {
      debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error'),
      close: () => Promise.resolve(),
    } satisfies ApplicationLogger,
  };
}

function response(dataset: string, rows: unknown[]): Response {
  return new Response(JSON.stringify({ total: 1, hasNext: false, items: [{ [dataset]: rows }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

describe('gateway FMA', () => {
  it('lista areas unicas a partir dos centros de trabalho do FMA', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('centrosTrabalho', [
      { codAreaProduc: '4113', codCtrab: 'LASER-01-01', desCtrab: 'LASER' },
      { codAreaProduc: '4104', codCtrab: 'PRE-006-01', desCtrab: 'PRENSA 25T' },
      { codAreaProduc: '4104', codCtrab: 'PRE-006-02', desCtrab: 'PRENSA 45T' },
    ]));
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/production-areas`, {
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual([
      { code: '4104', description: 'Área de Produção' },
      { code: '4113', description: 'Área de Produção' },
    ]);
    expect(String(transport.mock.calls[0][0])).toBe(
      'https://datasul.example.test/api/fma/v1/centrostrabalho?companyId=1&codUsuario=mjocelio',
    );
  });

  it('normaliza operadores, motivos e geração de equipe preservando códigos string', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('operadores', [{ codOperador: '00016570', nomOperador: 'Ana' }]))
      .mockResolvedValueOnce(response('motivosRefugo', [{ codMotivoRefugo: '05', desMotivoRefugo: 'Borra', refugoMaterial: true, refugoRetrabalho: true }]))
      .mockResolvedValueOnce(response('motivosParada', [{ codParada: '', desParada: '' }, { codParada: '07', desParada: 'Manutenção' }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{
        equipeResultado: [{ codEquipe: 'AUT0002', desEquipe: 'Equipe Automática', numTurno: 1 }],
        operadores: [{ codOperador: '00016570', nomOperador: 'Ana' }],
      }] }), { status: 200 }));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token()}`;

    await expect((await fetch(`${root}/api/operators`, { headers: { authorization } })).json())
      .resolves.toEqual([{ code: '00016570', name: 'Ana' }]);
    await expect((await fetch(`${root}/api/scrap-reasons`, { headers: { authorization } })).json())
      .resolves.toEqual([expect.objectContaining({ codigo: '05', descricao: 'Borra' })]);
    await expect((await fetch(`${root}/api/stop-reasons`, { headers: { authorization } })).json())
      .resolves.toEqual([{ id: 7, code: '07', description: 'Manutenção' }]);
    const team = await fetch(`${root}/api/teams`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ areaCode: '4104', workCenterCode: 'PRE-01', operadores: ['00016570'] }),
    });
    await expect(team.json()).resolves.toEqual({
      codigo: 'AUT0002', descricao: 'Equipe Automática', turno: '1',
      operadores: [{ codigo: '00016570', nome: 'Ana' }],
    });
    expect(JSON.parse(String(transport.mock.calls[3][1]?.body))).toEqual({
      codAreaProduc: '4104', codCtrab: 'PRE-01', operadores: ['00016570'],
    });
  });

  it('traduz reporte final individual, exige motivo único e mantém encerramento apenas local', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token()}`;
    const headers = {
      authorization, 'content-type': 'application/json', 'idempotency-key': 'report-final-1',
    };
    const body = {
      ordem: '372572', op: '10', split: '1', areaCode: '4113', ct: 'LASER-01-01',
      quantidadeAprovada: 10, quantidadeRetrabalho: 1, quantidadeRefugo: 0,
      refugoItens: [{ codigo: '05', descricao: 'Retrabalho', quantidade: 1 }],
      dataInicio: '2026-08-14T10:18:00.000Z', horaInicio: '07:18',
      dataFim: '2026-08-14T11:25:00.000Z', horaFim: '08:25',
      tipoResponsavel: 'OPERADOR', codigoResponsavel: '00016570', finalizarSplit: true,
    };
    const result = await fetch(`${root}/api/operations/report`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(result.status).toBe(200);
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      codAreaProduc: '4113', codCtrab: 'LASER-01-01', codOperador: '00016570', codEquipe: '',
      finalizarSplit: true,
      splits: [{ nrOrdemProducao: 372572, opCodigo: 10, numSplitOperac: 1, qtdAprovada: 10, qtdRetrabalho: 1, qtdRefugada: 0, codMotivoRefugo: '05' }],
    }));

    const invalid = await fetch(`${root}/api/operations/report`, {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'invalid-reason' },
      body: JSON.stringify({ ...body, refugoItens: [] }),
    });
    expect(invalid.status).toBe(400);
    const ending = await fetch(`${root}/api/operations/end`, {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'local-end-1' }, body: JSON.stringify({ ordem: '372572' }),
    });
    expect(ending.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('traduz início e reporte em batelada com receipts completos por ordem', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token([APP_PERMISSIONS.batchReporting])}`;
    const headers = { authorization, 'content-type': 'application/json', 'idempotency-key': 'batch-command-1' };
    const ordens = [
      { id: '372569|ITEM|20|1', ordem: '372569', operacao: '20', split: '1' },
      { id: '372570|ITEM|20|1', ordem: '372570', operacao: '20', split: '1' },
    ];
    const start = await fetch(`${root}/api/batches/start`, {
      method: 'POST', headers, body: JSON.stringify({
        contexto: { areaCode: '4114', workCenterCode: 'DOBR-01-01' },
        responsavel: { tipo: 'OPERADOR', codigo: '00016570' },
        iniciadoEm: '2026-08-14T12:35:00.000Z',
        dataInicio: '2026-08-14', horaInicio: '09:35', ordens,
      }),
    });
    const startReceipt = await start.json() as { orderResults: unknown[] };
    expect(startReceipt.orderResults).toHaveLength(2);

    const report = await fetch(`${root}/api/batches/report`, {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'batch-report-1' }, body: JSON.stringify({
        contexto: { areaCode: '4114', workCenterCode: 'DOBR-01-01' },
        responsavel: { tipo: 'OPERADOR', codigo: '00016570' },
        dataInicio: '2026-08-14T12:35:00.000Z', horaInicio: '09:35',
        dataFim: '2026-08-14T13:35:00.000Z', horaFim: '10:35', finalizarSplit: true,
        items: ordens.map(order => ({
          orderId: order.id, ordem: order.ordem, quantidadeAprovada: 1,
          quantidadeRetrabalho: 0, quantidadeRefugo: 0, refugoItens: [],
        })),
      }),
    });
    const reportReceipt = await report.json() as { orderResults: unknown[] };
    expect(reportReceipt.orderResults).toHaveLength(2);
    expect(String(transport.mock.calls[0][0])).toContain('/api/fma/v1/iniciarordembatelada');
    expect(String(transport.mock.calls[1][0])).toContain('/api/fma/v1/reporteordembatelada');
  });

  it('classifica parada aberta, retroativa e finalização posterior', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token([APP_PERMISSIONS.stoppages])}`;
    const base = {
      context: { area: { code: '4104' }, workCenter: { code: 'PRE-01' } },
      reason: { code: '07' }, responsible: { tipo: 'OPERADOR', codigo: '00016570' },
      startDate: '2026-08-14', startTime: '09:00', programmed: false,
    };
    const send = (path: string, idempotencyKey: string, body: object) => fetch(`${root}${path}`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    });
    expect((await send('/api/production-stops', 'stop-open', base)).status).toBe(200);
    expect((await send('/api/production-stops', 'stop-past', { ...base, endDate: '2026-08-14', endTime: '10:00' })).status).toBe(200);
    expect((await send('/api/production-stops/local-1/finish', 'stop-finish', {
      areaCode: '4104', workCenterCode: 'PRE-01', endDate: '2026-08-14', endTime: '11:00',
    })).status).toBe(200);
    expect(transport.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('/api/fma/v1/iniciaparada'),
      expect.stringContaining('/api/fma/v1/incluiparada'),
      expect.stringContaining('/api/fma/v1/finalizaparada'),
    ]);
  });

  it('lista e adapta centros de trabalho sem expor Basic ao browser', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('centrosTrabalho', [{ codAreaProduc: '4104', codCtrab: 'PRE-006-02', desCtrab: 'PRENSA 45T' }]));
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/work-centers?areaCode=4104&active=true`, {
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual([expect.objectContaining({
      code: 'PRE-006-02', description: 'PRENSA 45T', areaCode: '4104', active: true,
    })]);
    expect(String(transport.mock.calls[0][0])).toBe('https://datasul.example.test/api/fma/v1/centrostrabalho?companyId=1&codUsuario=mjocelio&codAreaProduc=4104');
    expect((transport.mock.calls[0][1]?.headers as Record<string, string>)['Authorization'])
      .toBe(`Basic ${Buffer.from('integracao:segredo-tecnico').toString('base64')}`);
  });

  it('adapta ordens liberadas e dados de abertura do apontamento', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('ordensLiberadas', [{ codItemOp: '31149', opCodigo: 10, nrOrdemProducao: 370215, numSplitOperac: 11 }]))
      .mockResolvedValueOnce(response('dadosApontamento', [{ desOperacao: 'CORTAR', qtdOrdem: 1000, qtdAprovada: 0, opCodigo: 10, itCodigo: '30907', desGrupoMaquina: 'PRENSA', desModelTurno: '2T', numSplitOperac: 11, qtdRefugo: 0, qtdSaldo: 1000, nrOrdemProducao: 370215, un: 'UN', codCtrab: 'PRE-006-02', descItem: 'ALAVANCA', codGrupoMaquina: 'PRE-006', qtdRetrabalho: 0, desCtrab: 'PRENSA 45T' }]));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token()}`;

    const orders = await fetch(`${root}/api/production-orders?areaCode=4104&workCenterCode=PRE-006-02&status=RELEASED`, { headers: { authorization } });
    await expect(orders.json()).resolves.toEqual([{
      id: '370215|31149|10|11', ordem: '370215', itemOp: '31149', operacao: '10', split: '11', areaCode: '4104', workCenterCode: 'PRE-006-02',
    }]);

    const operation = await fetch(`${root}/api/production-orders/370215/operations/10?split=11&areaCode=4104&workCenterCode=PRE-006-02`, { headers: { authorization } });
    await expect(operation.json()).resolves.toEqual(expect.objectContaining({
      ordem: '370215', op: '10', split: '11', item: '30907', descricao: 'ALAVANCA', quantidadeSaldo: 1000, ct: 'PRE-006-02', turno: '2T',
    }));
  });

  it('inicia a ordem com identidade confiável e devolve receipt reconciliável', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('inicioOrdem', [{ dataInicioReporte: '2026-07-21', horaInicioReporte: '0935', nrOrdemProducao: 372562, opCodigo: 10, numSplitOperac: 1, mensagem: 'Reporte iniciado com sucesso', codCtrab: 'PRE-006-02' }]));
    const root = await startGateway(transport);
    const body = { ordem: '372562', op: '10', split: '1', areaCode: '4104', workCenterCode: 'PRE-006-02', tipoResponsavel: 'OPERADOR', codigoResponsavel: '00016570', dataInicio: '2026-07-21T12:35:00.000Z', horaInicio: '09:35' };
    const result = await fetch(`${root}/api/operations/start`, {
      method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', 'idempotency-key': '123e4567-e89b-42d3-a456-426614174000' }, body: JSON.stringify(body),
    });

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual(expect.objectContaining({ idempotencyKey: '123e4567-e89b-42d3-a456-426614174000', duplicate: false }));
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({ codOperador: '00016570', codEquipe: '', dataInicioReporte: '2026-07-21', horaInicioReporte: '09:35' }));
    expect(String(transport.mock.calls[0][0])).toContain('/api/fma/v1/iniciaordem?companyId=1&codUsuario=mjocelio');
  });

  it('fecha acesso sem permissão e rejeita payload inválido antes do Datasul', async () => {
    const transport = vi.fn<typeof fetch>();
    const root = await startGateway(transport);
    const forbidden = await fetch(`${root}/api/work-centers?areaCode=4104`, { headers: { authorization: `Bearer ${await token([APP_PERMISSIONS.qualityControl])}` } });
    const invalid = await fetch(`${root}/api/operations/start`, { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', 'idempotency-key': 'key' }, body: '{}' });

    expect(forbidden.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });

  it('não permite iniciar operação apenas com permissão de Paradas', async () => {
    const transport = vi.fn<typeof fetch>();
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/operations/start`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}`,
        'content-type': 'application/json',
        'idempotency-key': '123e4567-e89b-42d3-a456-426614174000',
      },
      body: JSON.stringify({}),
    });

    expect(result.status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it('deduplica retry de iniciaordem e rejeita a mesma chave com outro comando', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('inicioOrdem', [{
      dataInicioReporte: '2026-07-21', horaInicioReporte: '0935', nrOrdemProducao: 372562,
      opCodigo: 10, numSplitOperac: 1, mensagem: 'Reporte iniciado com sucesso', codCtrab: 'PRE-006-02',
    }]));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token()}`;
    const headers = {
      authorization, 'content-type': 'application/json',
      'idempotency-key': '123e4567-e89b-42d3-a456-426614174000',
    };
    const body = {
      ordem: '372562', op: '10', split: '1', areaCode: '4104', workCenterCode: 'PRE-006-02',
      tipoResponsavel: 'OPERADOR', codigoResponsavel: '00016570',
      dataInicio: '2026-07-21T12:35:00.000Z', horaInicio: '09:35',
    };

    const first = await fetch(`${root}/api/operations/start`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const retry = await fetch(`${root}/api/operations/start`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const conflict = await fetch(`${root}/api/operations/start`, {
      method: 'POST', headers, body: JSON.stringify({ ...body, ordem: '372563' }),
    });

    expect(first.status).toBe(200);
    await expect(retry.json()).resolves.toEqual(expect.objectContaining({ duplicate: true }));
    expect(conflict.status).toBe(409);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('registra sucesso FMA sem query, usuário ou credenciais', async () => {
    const sink = logSink();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('centrosTrabalho', []));
    const root = await startGateway(transport, sink.logger);
    const result = await fetch(`${root}/api/work-centers?areaCode=4104`, {
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(result.status).toBe(200);
    expect(sink.events).toContainEqual(expect.objectContaining({
      event: 'upstream_request_completed',
      metadata: expect.objectContaining({ route: '/api/fma/v1/centrostrabalho', status: 200 }),
    }));
    expect(JSON.stringify(sink.events)).not.toMatch(/mjocelio|4104|segredo-tecnico|Basic|companyId/);
  });

  it.each([
    ['timeout', async () => { throw Object.assign(new Error('Bearer segredo'), { name: 'TimeoutError' }); }, 502],
    ['http_status', async () => new Response('{}', { status: 503 }), 503],
  ])('registra falha FMA %s com categoria pública', async (category, transport, status) => {
    const sink = logSink();
    const root = await startGateway(vi.fn<typeof fetch>().mockImplementation(transport), sink.logger);
    const result = await fetch(`${root}/api/work-centers?areaCode=4104`, {
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(result.status).toBe(status);
    expect(sink.events).toContainEqual(expect.objectContaining({
      event: 'upstream_request_failed',
      metadata: expect.objectContaining({ failureCategory: category }),
    }));
    expect(JSON.stringify(sink.events)).not.toMatch(/segredo-tecnico|Bearer segredo|mjocelio|4104/);
  });
});
