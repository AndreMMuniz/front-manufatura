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

async function postBatchStart(root: string, idempotencyKey: string): Promise<Response> {
  return fetch(`${root}/api/batches/start`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await token([APP_PERMISSIONS.batchReporting])}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
      contexto: { areaCode: '4114', workCenterCode: 'DOBR-01-01' },
      responsavel: { tipo: 'OPERADOR', codigo: '00016570' },
      dataInicio: '2026-08-14',
      horaInicio: '09:35',
      ordens: [
        { id: '372569|ITEM|20|1', ordem: '372569', operacao: '20', split: '1' },
        { id: '372570|ITEM|20|1', ordem: '372570', operacao: '20', split: '1' },
      ],
    }),
  });
}

describe('gateway FMA', () => {
  it('não inventa um catálogo de Áreas sem endpoint correspondente no FMA', async () => {
    const transport = vi.fn<typeof fetch>();
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/production-areas`, {
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(result.status).toBe(404);
    expect(transport).not.toHaveBeenCalled();
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

  it('consolida operadores e equipes elegíveis para o contexto operacional', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('operadores', [
        { codAreaProduc: '4104', codOperador: '00016570', nomOperador: 'Ana', numTurno: 1 },
        { codAreaProduc: '4110', codOperador: '00016575', nomOperador: 'Carla', numTurno: 1 },
        { codAreaProduc: '', codOperador: '00016580', nomOperador: 'Bruno', numTurno: 2 },
      ]))
      .mockResolvedValueOnce(response('Equipes', [
        { codAreaProduc: '4104', codEquipe: 'PRE-006', numTurno: 1, nomEquipe: 'Preparação 6' },
        { codAreaProduc: '4110', codEquipe: 'EMP-01', numTurno: 1, nomEquipe: 'Empacotadora 1' },
      ]));
    const root = await startGateway(transport);
    const result = await fetch(
      `${root}/api/operational-responsibles?areaCode=4104&workCenterCode=PRE-006-02`,
      { headers: { authorization: `Bearer ${await token()}` } },
    );

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual([
      { tipo: 'OPERADOR', codigo: '00016570', nome: 'Ana' },
      { tipo: 'EQUIPE', codigo: 'PRE-006', nome: 'Preparação 6' },
    ]);
    expect(String(transport.mock.calls[0][0])).toBe(
      'https://datasul.example.test/api/fma/v1/operadores?companyId=1&codUsuario=mjocelio',
    );
    expect(String(transport.mock.calls[1][0])).toBe(
      'https://datasul.example.test/api/fma/v1/equipes?companyId=1&codUsuario=mjocelio',
    );
  });

  it('lista somente as equipes da Área de Produção da ordem', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('Equipes', [
      { codAreaProduc: '4110', codEquipe: 'EMP-01', numTurno: 1, nomEquipe: 'Empacotadora 1' },
      { codAreaProduc: '4120', codEquipe: 'FBAN-003', numTurno: 1, nomEquipe: 'Fábrica 3' },
      { codAreaProduc: '', codEquipe: 'SEM-AREA', numTurno: 0, nomEquipe: 'Sem área' },
    ]));
    const root = await startGateway(transport);
    const result = await fetch(
      `${root}/api/teams?areaCode=4110&workCenterCode=EMP-01-02`,
      { headers: { authorization: `Bearer ${await token()}` } },
    );

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual([{
      codigo: 'EMP-01',
      descricao: 'Empacotadora 1',
      turno: '1',
      operadores: [],
    }]);
    expect(String(transport.mock.calls[0][0])).toBe(
      'https://datasul.example.test/api/fma/v1/equipes?companyId=1&codUsuario=mjocelio',
    );
  });

  it('traduz reporte final individual sem fechar o split e encerra o split em chamada dependente', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('reporteOrdem', [{
        qtdRefugada: 2, qtdAprovada: 10, finalizarSplit: false,
        dataInicioReporte: '2026-08-14', opCodigo: 10, horaInicioReporte: '',
        mensagem: 'Reporte gravado com sucesso', numSplitOperac: 1,
        nrOrdemProducao: 372572, horaFimReporte: '', codCtrab: 'LASER-01-01',
        qtdRetrabalho: 1, dataFimReporte: '2026-08-14',
      }]))
      .mockResolvedValueOnce(response('splitResultado', [{
        operacaoFechada: true, opCodigo: 10, nrOrdemProducao: 372572,
        mensagem: 'Split encerrado', numSplitOperac: 1, estadoSplit: 5,
      }]));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token()}`;
    const headers = {
      authorization, 'content-type': 'application/json', 'idempotency-key': 'report-final-1',
    };
    const body = {
      ordem: '372572', op: '10', split: '1', areaCode: '4113', ct: 'LASER-01-01',
      quantidadeAprovada: 10, quantidadeRetrabalho: 1, quantidadeRefugo: 2,
      refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 2 }],
      dataInicio: '2026-08-14T10:18:00.000Z', horaInicio: '07:18',
      dataFim: '2026-08-14T11:25:00.000Z', horaFim: '08:25',
      tipoResponsavel: 'OPERADOR', codigoResponsavel: '00016570', finalizarSplit: false,
    };
    const result = await fetch(`${root}/api/operations/report`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(result.status).toBe(200);
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      codAreaProduc: '4113',
      codCtrab: 'LASER-01-01',
      nrOrdemProducao: 372572,
      opCodigo: 10,
      numSplitOperac: 1,
      qtdAprovada: 10,
      qtdRetrabalho: 1,
      qtdRefugada: 2,
      dataInicioReporte: '2026-08-14',
      horaInicioReporte: '07:18',
      dataFimReporte: '2026-08-14',
      horaFimReporte: '08:25',
      codOperador: '00016570',
      codEquipe: '',
      codFerramenta: '',
      codReferencia: '',
      loteSerie: '',
      dataValidadeLote: '',
      codMotivoRefugo: '05',
      contaRefugo: '',
      dataInicioSetup: '',
      horaInicioSetup: '',
      dataFimSetup: '',
      horaFimSetup: '',
      finalizarSplit: false,
    });
    const ending = await fetch(`${root}/api/operations/end`, {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'end-1' }, body: JSON.stringify({
        ordem: '372572', op: '10', split: '1', areaCode: '4113', ct: 'LASER-01-01',
      }),
    });
    expect(ending.status).toBe(200);
    expect(String(transport.mock.calls[1][0])).toBe(
      'https://datasul.example.test/api/fma/v1/encerrasplit?companyId=1&codUsuario=mjocelio',
    );
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({
      codAreaProduc: '4113', codCtrab: 'LASER-01-01', nrOrdemProducao: 372572,
      opCodigo: 10, numSplitOperac: 1,
    });
  });

  it('envia retrabalho sem exigir codMotivoRefugo', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/operations/report`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
        'idempotency-key': 'report-rework-without-reason',
      },
      body: JSON.stringify({
        ordem: '372572', op: '10', split: '1', areaCode: '4113', ct: 'LASER-01-01',
        quantidadeAprovada: 10, quantidadeRetrabalho: 1, quantidadeRefugo: 0, refugoItens: [],
        dataInicio: '2026-08-14T10:18:00.000Z', horaInicio: '07:18',
        dataFim: '2026-08-14T11:25:00.000Z', horaFim: '08:25',
        tipoResponsavel: 'OPERADOR', codigoResponsavel: '00016570', finalizarSplit: false,
      }),
    });

    expect(result.status).toBe(200);
    const command = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(command).toEqual(expect.objectContaining({
      nrOrdemProducao: 372572, opCodigo: 10, numSplitOperac: 1,
      qtdAprovada: 10, qtdRetrabalho: 1, qtdRefugada: 0, codMotivoRefugo: '',
    }));
    expect(command).not.toHaveProperty('splits');
    expect(command).not.toHaveProperty('quantidadeMotivo');
  });

  it('rejeita refugo sem exatamente um motivo', async () => {
    const transport = vi.fn<typeof fetch>();
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/operations/report`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
        'idempotency-key': 'report-scrap-without-reason',
      },
      body: JSON.stringify({
        ordem: '372572', op: '10', split: '1', areaCode: '4113', ct: 'LASER-01-01',
        quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 2, refugoItens: [],
        dataInicio: '2026-08-14T10:18:00.000Z', horaInicio: '07:18',
        dataFim: '2026-08-14T11:25:00.000Z', horaFim: '08:25',
        tipoResponsavel: 'OPERADOR', codigoResponsavel: '00016570', finalizarSplit: false,
      }),
    });

    expect(result.status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([true, false])('aceita encerramento com operacaoFechada=%s e mantém retry idempotente', async operacaoFechada => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('splitResultado', [{
      operacaoFechada, opCodigo: 10, nrOrdemProducao: 372561,
      mensagem: 'Split encerrado', numSplitOperac: 1, estadoSplit: 5,
    }]));
    const root = await startGateway(transport);
    const headers = {
      authorization: `Bearer ${await token()}`,
      'content-type': 'application/json',
      'idempotency-key': `end-${String(operacaoFechada)}`,
    };
    const body = JSON.stringify({
      ordem: '372561', op: '10', split: '1', areaCode: '4104', ct: 'PRE-006-02',
    });

    const first = await fetch(`${root}/api/operations/end`, { method: 'POST', headers, body });
    const retry = await fetch(`${root}/api/operations/end`, { method: 'POST', headers, body });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(expect.objectContaining({ duplicate: false }));
    expect(await retry.json()).toEqual(expect.objectContaining({ duplicate: true }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejeita reutilização divergente da chave de encerramento', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response('splitResultado', [{
      operacaoFechada: true, opCodigo: 10, nrOrdemProducao: 372561,
      numSplitOperac: 1, estadoSplit: 5,
    }]));
    const root = await startGateway(transport);
    const headers = {
      authorization: `Bearer ${await token()}`,
      'content-type': 'application/json',
      'idempotency-key': 'same-end-key',
    };
    const firstBody = {
      ordem: '372561', op: '10', split: '1', areaCode: '4104', ct: 'PRE-006-02',
    };

    expect((await fetch(`${root}/api/operations/end`, {
      method: 'POST', headers, body: JSON.stringify(firstBody),
    })).status).toBe(200);
    const conflict = await fetch(`${root}/api/operations/end`, {
      method: 'POST', headers, body: JSON.stringify({ ...firstBody, split: '2' }),
    });

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ code: 'idempotency-conflict' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('não confirma falha HTTP do EncerrarSplit e permite nova tentativa', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(response('splitResultado', [{
        operacaoFechada: true, opCodigo: 10, nrOrdemProducao: 372561,
        numSplitOperac: 1, estadoSplit: 5,
      }]));
    const root = await startGateway(transport);
    const headers = {
      authorization: `Bearer ${await token()}`,
      'content-type': 'application/json',
      'idempotency-key': 'retry-after-http-failure',
    };
    const request = {
      method: 'POST', headers, body: JSON.stringify({
        ordem: '372561', op: '10', split: '1', areaCode: '4104', ct: 'PRE-006-02',
      }),
    } as const;

    const failed = await fetch(`${root}/api/operations/end`, request);
    const retry = await fetch(`${root}/api/operations/end`, request);

    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ code: 'datasul-request-failed' });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual(expect.objectContaining({ duplicate: false }));
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['sem envelope', {}],
    ['sem resultado', { total: 1, hasNext: false, items: [{ splitResultado: [] }] }],
    ['com ordem divergente', { total: 1, hasNext: false, items: [{ splitResultado: [{
      operacaoFechada: true, opCodigo: 10, nrOrdemProducao: 999999,
      numSplitOperac: 1, estadoSplit: 5,
    }] }] }],
    ['com operação divergente', { total: 1, hasNext: false, items: [{ splitResultado: [{
      operacaoFechada: true, opCodigo: 20, nrOrdemProducao: 372561,
      numSplitOperac: 1, estadoSplit: 5,
    }] }] }],
    ['com split divergente', { total: 1, hasNext: false, items: [{ splitResultado: [{
      operacaoFechada: true, opCodigo: 10, nrOrdemProducao: 372561,
      numSplitOperac: 2, estadoSplit: 5,
    }] }] }],
  ])('rejeita resposta de EncerrarSplit %s', async (_scenario, upstream) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/operations/end`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
        'idempotency-key': 'invalid-end-response',
      },
      body: JSON.stringify({
        ordem: '372561', op: '10', split: '1', areaCode: '4104', ct: 'PRE-006-02',
      }),
    });

    expect(result.status).toBe(502);
    await expect(result.json()).resolves.toEqual({ code: 'invalid-upstream-response' });
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
    const reportReceipt = await report.json() as {
      orderResults: ReadonlyArray<{
        orderId: string;
        success: boolean;
        serverRecordId?: string;
      }>;
    };
    expect(reportReceipt.orderResults).toEqual(ordens.map(order => ({
      orderId: order.id,
      success: true,
    })));
    expect(String(transport.mock.calls[0][0])).toContain('/api/fma/v1/iniciarordembatelada');
    expect(String(transport.mock.calls[1][0])).toContain('/api/fma/v1/reporteordembatelada');
  });

  it('preserva a mensagem de rejeição do Datasul em HTTP não-2xx ao iniciar batelada', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      type: 'error',
      message: 'A ordem 372569 já está iniciada.',
      details: [],
    }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);

    const result = await postBatchStart(root, 'batch-rejected-http');

    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_COMMAND_REJECTED',
      category: 'VALIDATION',
      userMessage: 'A ordem 372569 já está iniciada.',
    });
  });

  it('trata envelope de erro em HTTP 2xx como rejeição terminal ao iniciar batelada', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      type: 'error',
      detailedMessage: 'O centro de trabalho não permite iniciar esta ordem.',
      details: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);

    const result = await postBatchStart(root, 'batch-rejected-envelope');

    expect(result.status).toBe(422);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_COMMAND_REJECTED',
      category: 'VALIDATION',
      userMessage: 'O centro de trabalho não permite iniciar esta ordem.',
    });
  });

  it('devolve fallback terminal quando o Datasul respondeu sem mensagem segura', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      type: 'error',
      message: 'Falha interna com token=segredo-que-nao-pode-sair.',
      details: [],
    }), { status: 503, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);

    const result = await postBatchStart(root, 'batch-rejected-without-message');

    expect(result.status).toBe(422);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_BATCH_START_REJECTED',
      category: 'VALIDATION',
      userMessage: 'O Datasul rejeitou o início da batelada sem informar o motivo. Verifique as ordens antes de tentar novamente.',
    });
  });

  it.each([408, 504])(
    'mantém timeout HTTP %s do início da batelada como falha transitória',
    async (status) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      const root = await startGateway(transport);

      const result = await postBatchStart(root, `batch-timeout-${status}`);

      expect(result.status).toBe(status);
      await expect(result.json()).resolves.toEqual({ code: 'datasul-request-failed' });
    },
  );

  it.each([
    'Falha com client_secret=valor-privado.',
    'Falha com refresh_token=valor-privado.',
    'Falha com Authorization: Bearer valor-privado.',
    'Falha com JWT eyJhbGciOiJIUzI1NiJ9.valor.assinatura.',
  ])('não expõe variante de credencial na mensagem pública: %s', async (message) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      type: 'error',
      message,
      details: [],
    }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);

    const result = await postBatchStart(root, `batch-sensitive-${message.length}`);

    expect(result.status).toBe(422);
    const body = await result.json() as { userMessage: string };
    expect(body.userMessage).not.toContain('valor-privado');
    expect(body.userMessage).not.toContain('eyJhbGci');
  });

  it('classifica parada aberta, retroativa e finalização posterior', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token([APP_PERMISSIONS.stoppages])}`;
    const base = {
      context: { area: { code: '4104' }, workCenter: { code: 'PRE-01' } },
      reason: { code: '07' }, responsible: { tipo: 'OPERADOR', codigo: '00016570' },
      startDate: '2026-08-14', startTime: '09:00',
    };
    const send = (path: string, idempotencyKey: string, body: object) => fetch(`${root}${path}`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    });
    expect((await send('/api/production-stops', 'stop-open', base)).status).toBe(200);
    expect((await send('/api/production-stops', 'stop-legacy', {
      ...base,
      programmed: true,
    })).status).toBe(200);
    expect((await send('/api/production-stops', 'stop-past', { ...base, endDate: '2026-08-14', endTime: '10:00' })).status).toBe(200);
    expect((await send('/api/production-stops/local-1/finish', 'stop-finish', {
      areaCode: '4104', workCenterCode: 'PRE-01', endDate: '2026-08-14', endTime: '11:00',
    })).status).toBe(200);
    expect(transport.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('/api/fma/v1/iniciaparada'),
      expect.stringContaining('/api/fma/v1/iniciaparada'),
      expect.stringContaining('/api/fma/v1/incluiparada'),
      expect.stringContaining('/api/fma/v1/finalizaparada'),
    ]);
  });

  it('consulta e adapta as paradas iniciadas do Centro de Trabalho', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      total: 1,
      hasNext: false,
      items: [{
        paradasIniciadas: [{
          numOmProgda: 0,
          desParada: 'MANUTENCAO PREVENTIVA',
          dataReporte: '2026-09-02',
          codUsuarReporte: 'mjocelio',
          horaInicioParada: '14:03',
          horaReporte: '',
          codCtrab: 'LASER-01-01',
          dataInicioParada: '2026-09-02',
          codEquipe: '00016570',
          codParada: '05',
        }],
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);

    const result = await fetch(
      `${root}/api/production-stops?workCenterCode=LASER-01-01`,
      { headers: { authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}` } },
    );

    expect(result.status).toBe(200);
    expect(String(transport.mock.calls[0][0])).toBe(
      'https://datasul.example.test/api/fma/v1/paradasiniciadas?companyId=1&codUsuario=mjocelio&codCtrab=LASER-01-01',
    );
    await expect(result.json()).resolves.toEqual([{
      id: 'datasul:LASER-01-01:2026-09-02:14:03:05:00016570:mjocelio',
      programNumber: 0,
      workCenterCode: 'LASER-01-01',
      reason: { id: 5, code: '05', description: 'MANUTENCAO PREVENTIVA' },
      responsible: { tipo: 'EQUIPE', codigo: '00016570', nome: '00016570' },
      startDate: '2026-09-02',
      startTime: '14:03',
      reportDate: '2026-09-02',
      reportTime: '',
      reportedBy: 'mjocelio',
    }]);
  });

  it('finaliza a parada do contexto sem exigir um identificador local', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const root = await startGateway(transport);

    const result = await fetch(`${root}/api/production-stops/finish`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}`,
        'content-type': 'application/json',
        'idempotency-key': 'stop-finish-context',
      },
      body: JSON.stringify({
        areaCode: '4113',
        workCenterCode: 'LASER-01-01',
        endDate: '2026-08-14',
        endTime: '09:40',
      }),
    });

    expect(result.status).toBe(200);
    expect(String(transport.mock.calls[0][0])).toContain('/api/fma/v1/finalizaparada');
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      codAreaProduc: '4113',
      codCtrab: 'LASER-01-01',
      dataFimParada: '2026-08-14',
      horaFimParada: '09:40',
    });
  });

  it('elimina a parada selecionada usando o contrato observado do Datasul', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const root = await startGateway(transport);

    const result = await fetch(`${root}/api/production-stops/stop%2F01/eliminate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}`,
        'content-type': 'application/json',
        'idempotency-key': 'stop-delete-1',
      },
      body: JSON.stringify({
        stopLocalId: 'stop/01',
        areaCode: '4104',
        workCenterCode: 'PRE-006-02',
        reasonCode: '05',
        startDate: '2026-08-14',
        startTime: '09:04',
      }),
    });

    expect(result.status).toBe(200);
    expect(String(transport.mock.calls[0][0])).toBe(
      'https://datasul.example.test/api/fma/v1/eliminaparada?companyId=1&codUsuario=mjocelio',
    );
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      codAreaProduc: '4104',
      codCtrab: 'PRE-006-02',
      codParada: '05',
      dataInicioParada: '2026-08-14',
      horaInicioParada: '09:04',
    });
  });

  it('propaga a mensagem devolvida pelo Datasul ao rejeitar a eliminação', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      message: 'A parada possui reportes relacionados e não pode ser eliminada.',
      type: 'error',
    }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);

    const result = await fetch(`${root}/api/production-stops/stop-1/eliminate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}`,
        'content-type': 'application/json',
        'idempotency-key': 'stop-delete-rejected',
      },
      body: JSON.stringify({
        stopLocalId: 'stop-1',
        areaCode: '4104',
        workCenterCode: 'PRE-006-02',
        reasonCode: '05',
        startDate: '2026-08-14',
        startTime: '09:04',
      }),
    });

    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_COMMAND_REJECTED',
      category: 'VALIDATION',
      userMessage: 'A parada possui reportes relacionados e não pode ser eliminada.',
    });
  });

  it('não transforma em pendência uma rejeição sem mensagem do Datasul', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const root = await startGateway(transport);

    const result = await fetch(`${root}/api/production-stops/stop-1/eliminate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}`,
        'content-type': 'application/json',
        'idempotency-key': 'stop-delete-rejected-without-message',
      },
      body: JSON.stringify({
        stopLocalId: 'stop-1',
        areaCode: '4104',
        workCenterCode: 'PRE-006-02',
        reasonCode: '05',
        startDate: '2026-08-14',
        startTime: '09:04',
      }),
    });

    expect(result.status).toBe(422);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_STOP_DELETE_REJECTED',
      category: 'VALIDATION',
      userMessage: 'O Datasul rejeitou a eliminação da parada sem informar o motivo.',
    });
  });

  it('classifica como conflito o erro Datasul documentado para intervalo de parada duplicado', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      detailedMessage: 'Já existe reporte neste intervalo de data e hora.',
      code: '1',
      details: [{
        detailedMessage: 'Reporte já cadastrado com este intervalo de tempo.',
        code: '2',
        message: 'Reporte já cadastrado com este intervalo de tempo.',
        type: 'error',
      }],
      message: 'Já existe reporte neste intervalo de data e hora.',
      type: 'error',
    }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/production-stops`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}`,
        'content-type': 'application/json',
        'idempotency-key': 'stop-duplicada',
      },
      body: JSON.stringify({
        context: { area: { code: '4113' }, workCenter: { code: 'LASER-01-01' } },
        reason: { code: '07' },
        responsible: { tipo: 'OPERADOR', codigo: '00016570' },
        startDate: '2026-08-14', startTime: '09:04',
      }),
    });

    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_STOP_INTERVAL_CONFLICT',
      category: 'CONFLICT',
      userMessage: 'Já existe reporte neste intervalo de data e hora.',
    });
  });

  it('classifica como validação o erro Datasul documentado para parada no futuro', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      detailedMessage: 'Não é permitido criar Reporte Parada Centro Trab para o futuro.',
      code: '1',
      details: [{
        detailedMessage: 'Data de Transação maior que Data do Processamento.',
        code: '2',
        message: 'Data de Transação maior que Data do Processamento.',
        type: 'error',
      }],
      message: 'Não é permitido criar Reporte Parada Centro Trab para o futuro.',
      type: 'error',
    }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/production-stops`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token([APP_PERMISSIONS.stoppages])}`,
        'content-type': 'application/json',
        'idempotency-key': 'stop-futura',
      },
      body: JSON.stringify({
        context: { area: { code: '4104' }, workCenter: { code: 'PRE-006-01' } },
        reason: { code: '05' },
        responsible: { tipo: 'OPERADOR', codigo: '00016570' },
        startDate: '2026-08-20', startTime: '09:00',
        endDate: '2026-08-20', endTime: '11:00',
      }),
    });

    expect(result.status).toBe(422);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_FUTURE_STOP',
      category: 'VALIDATION',
      userMessage: 'Não é permitido criar Reporte Parada Centro Trab para o futuro.',
    });
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
      .mockResolvedValueOnce(response('ordensLiberadas', [{ codItemOp: '31149', opCodigo: 10, nrOrdemProducao: 370215, numSplitOperac: 11, indEstadoSplit: 4 }]))
      .mockResolvedValueOnce(response('dadosApontamento', [{ desOperacao: 'CORTAR', qtdOrdem: 1000, qtdAprovada: 0, opCodigo: 10, itCodigo: '30907', desGrupoMaquina: 'PRENSA', desModelTurno: '2T', numSplitOperac: 11, qtdRefugo: 0, qtdSaldo: 1000, nrOrdemProducao: 370215, un: 'UN', codCtrab: 'PRE-006-02', descItem: 'ALAVANCA', codGrupoMaquina: 'PRE-006', qtdRetrabalho: 0, desCtrab: 'PRENSA 45T' }]));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token()}`;

    const orders = await fetch(`${root}/api/production-orders?areaCode=4104&workCenterCode=PRE-006-02&status=RELEASED`, { headers: { authorization } });
    await expect(orders.json()).resolves.toEqual([{
      id: '370215|31149|10|11', ordem: '370215', itemOp: '31149', operacao: '10', split: '11',
      indEstadoSplit: 4, areaCode: '4104', workCenterCode: 'PRE-006-02',
    }]);

    const operation = await fetch(`${root}/api/production-orders/370215/operations/10?split=11&areaCode=4104&workCenterCode=PRE-006-02`, { headers: { authorization } });
    await expect(operation.json()).resolves.toEqual(expect.objectContaining({
      ordem: '370215', op: '10', split: '11', item: '30907', descricao: 'ALAVANCA', quantidadeSaldo: 1000, ct: 'PRE-006-02', turno: '2T',
    }));
  });

  it('devolve o início real ao abrir um split que já está iniciado', async () => {
    const opening = {
      desOperacao: 'CORTAR', qtdOrdem: 1000, qtdAprovada: 0, opCodigo: 10,
      itCodigo: '30907', desGrupoMaquina: 'PRENSA', desModelTurno: '2T',
      numSplitOperac: 11, qtdRefugo: 0, qtdSaldo: 1000, nrOrdemProducao: 370215,
      un: 'UN', codCtrab: 'PRE-006-02', descItem: 'ALAVANCA', codGrupoMaquina: 'PRE-006',
      qtdRetrabalho: 0, desCtrab: 'PRENSA 45T',
    };
    const orderDetails = {
      total: 1,
      hasNext: false,
      items: [{
        'ds-ordem-producao': {
          ordem: [{
            nrOrdemProducao: 370215,
            codItem: '30907',
            operacoes: [{
              codOperacao: 10,
              dtInicioReal: '2026-08-29',
              horaInicioReal: '09:35',
              splits: [{
                numSplit: 11,
                estadoSplit: 4,
                dtInicioOperacao: '2026-08-29',
                segsInicioOperacao: 34_500,
              }],
            }],
          }],
        },
      }],
    };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('dadosApontamento', [opening]))
      .mockResolvedValueOnce(new Response(JSON.stringify(orderDetails), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    const root = await startGateway(transport);
    const result = await fetch(
      `${root}/api/production-orders/370215/operations/10?split=11&splitState=4&areaCode=4104&workCenterCode=PRE-006-02`,
      { headers: { authorization: `Bearer ${await token()}` } },
    );

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual(expect.objectContaining({
      ordem: '370215',
      op: '10',
      split: '11',
      dataInicio: '2026-08-29',
      horaInicio: '09:35',
    }));
    expect(String(transport.mock.calls[1]?.[0])).toBe(
      'https://datasul.example.test/api/fcq/v1/ordens/370215?companyId=1&codUsuario=mjocelio',
    );
  });

  it('preserva o modo de reporte da abertura sem converter valores inválidos', async () => {
    const base = {
      desOperacao: 'CORTAR', qtdOrdem: 1000, qtdAprovada: 0, opCodigo: 10,
      itCodigo: '30907', desGrupoMaquina: 'PRENSA', desModelTurno: '2T',
      numSplitOperac: 1, qtdRefugo: 0, qtdSaldo: 1000, nrOrdemProducao: 372562,
      un: 'UN', codCtrab: 'PRE-006-02', descItem: 'ALAVANCA', codGrupoMaquina: 'PRE-006',
      qtdRetrabalho: 0, desCtrab: 'PRENSA 45T',
    };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('dadosApontamento', [{ ...base, indReporteMod: 2 }]))
      .mockResolvedValueOnce(response('dadosApontamento', [{ ...base, indReportMod: 3 }]))
      .mockResolvedValueOnce(response('dadosApontamento', [{ ...base, indReporteMod: '2' }]));
    const root = await startGateway(transport);
    const authorization = `Bearer ${await token()}`;
    const url = `${root}/api/production-orders/372562/operations/10?split=1&areaCode=4104&workCenterCode=PRE-006-02`;

    await expect((await fetch(url, { headers: { authorization } })).json())
      .resolves.toEqual(expect.objectContaining({ indReporteMod: 2 }));
    await expect((await fetch(url, { headers: { authorization } })).json())
      .resolves.toEqual(expect.objectContaining({ indReporteMod: 3 }));
    await expect((await fetch(url, { headers: { authorization } })).json())
      .resolves.not.toHaveProperty('indReporteMod');
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

  it('preserva o motivo de negócio quando o Datasul rejeita o início com HTTP 500', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      type: 'error',
      message: 'Split já iniciado.',
      details: [{ message: 'Split já iniciado.' }],
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    }));
    const root = await startGateway(transport);
    const result = await fetch(`${root}/api/operations/start`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
        'idempotency-key': '123e4567-e89b-42d3-a456-426614174000',
      },
      body: JSON.stringify({
        ordem: '372562', op: '10', split: '1', areaCode: '4104',
        workCenterCode: 'PRE-006-02', tipoResponsavel: 'OPERADOR',
        codigoResponsavel: '00016570', dataInicio: '2026-07-21T12:35:00.000Z',
        horaInicio: '09:35',
      }),
    });

    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({
      code: 'DATASUL_COMMAND_REJECTED',
      category: 'VALIDATION',
      userMessage: 'Split já iniciado.',
    });
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
