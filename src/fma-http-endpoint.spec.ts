// @vitest-environment node

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppSessionToken } from './app-session-token';
import { APP_PERMISSIONS } from './app-permissions';
import { installFmaEndpoints } from './fma-http-endpoint';

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

async function startGateway(transport: typeof fetch): Promise<string> {
  const app = express();
  installFmaEndpoints(app, { env: ENV, transport });
  let server!: RunningServer;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function response(dataset: string, rows: unknown[]): Response {
  return new Response(JSON.stringify({ total: 1, hasNext: false, items: [{ [dataset]: rows }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

describe('gateway FMA', () => {
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
});
