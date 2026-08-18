// @vitest-environment node

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppSessionToken } from './app-session-token';
import { APP_PERMISSIONS } from './app-permissions';
import {
  buildQualityResultPayload,
  installQualityControlEndpoints,
  resolveQualityControlUserId,
} from './quality-control-http-endpoint';
import {
  QualityControlDatasulClient,
  readQualityControlDatasulConfig,
} from './quality-control-datasul-client';

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

async function startGateway(transport: typeof fetch): Promise<string> {
  const app = express();
  installQualityControlEndpoints(app, { env: ENV, transport });
  let server!: RunningServer;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/quality-control`;
}

describe('gateway Plano Controle CQ', () => {
  it('falha fechado quando a conta técnica não está configurada', () => {
    expect(() => readQualityControlDatasulConfig({ ...ENV, DATASUL_INTEGRATION_PASSWORD: '' }))
      .toThrowError(expect.objectContaining({
        status: 503, code: 'quality-control-gateway-not-configured',
      }));
  });

  it('preserva companyId e Basic somente no cliente server-side', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      total: 1, hasNext: false, items: [{
        nrFicha: 64378, codExame: 1845, codComponente: 3, resultado: 1,
        dentroFaixa: true, componentesSalvos: 1, componentesTotal: 1,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new QualityControlDatasulClient(
      readQualityControlDatasulConfig(ENV),
      transport,
      () => new AbortController().signal,
    );
    await client.saveResult({ nrFicha: 64378, codUsuario: 'OPERADOR1' });

    const [url, init] = transport.mock.calls[0];
    expect(String(url)).toBe('https://datasul.example.test/api/fcq/v1/resultexames?companyId=1');
    expect((init?.headers as Record<string, string>)['Authorization'])
      .toBe(`Basic ${Buffer.from('integracao:segredo-tecnico', 'utf8').toString('base64')}`);
  });

  it('preserva a capitalização observada em roteiros e finalização', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      total: 1, hasNext: false, items: [{ nrFicha: 64378 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new QualityControlDatasulClient(
      readQualityControlDatasulConfig(ENV),
      transport,
      () => new AbortController().signal,
    );

    await client.getRoute({ nrOrdemProducao: 372562, codOperacao: 20 });
    await client.finalizeRoute({ nrFicha: 64378, codUsuario: 'OPERADOR1' });

    expect(String(transport.mock.calls[0][0]))
      .toBe('https://datasul.example.test/api/fcq/v1/roteiros?companyid=1');
    expect(String(transport.mock.calls[1][0]))
      .toBe('https://datasul.example.test/api/fcq/v1/FinalizaRoteiros?companyId=1');
  });

  it('aceita somente JWT válido e deriva codUsuario do subject', async () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    const issued = await createAppSessionToken({
      subject: 'OPERADOR1',
      permissions: [APP_PERMISSIONS.qualityControl],
      secret: ENV.APP_AUTH_TOKEN_SECRET,
      ttlMs: 60_000,
      now,
    });

    await expect(resolveQualityControlUserId(`Bearer ${issued.token}`, ENV, now))
      .resolves.toBe('OPERADOR1');
    await expect(resolveQualityControlUserId('Bearer token-invalido', ENV, now))
      .rejects.toMatchObject({ status: 401, code: 'invalid-session' });
  });

  it('bloqueia token válido sem permissão do Plano Controle CQ', async () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    const issued = await createAppSessionToken({
      subject: 'OPERADOR1',
      permissions: [APP_PERMISSIONS.operationReporting],
      secret: ENV.APP_AUTH_TOKEN_SECRET,
      ttlMs: 60_000,
      now,
    });

    await expect(resolveQualityControlUserId(`Bearer ${issued.token}`, ENV, now))
      .rejects.toMatchObject({ status: 403, code: 'access-denied' });
  });

  it('ignora codUsuario do browser e usa exclusivamente o subject validado', () => {
    expect(buildQualityResultPayload({
      nrFicha: 64378, codExame: 1845, codComponente: 3,
      nrTabela: 8, seqOpcao: 1, codUsuario: 'NAO_CONFIAR',
    }, 'OPERADOR1')).toEqual({
      nrFicha: 64378, codExame: 1845, codComponente: 3,
      nrTabela: 8, seqOpcao: 1, codUsuario: 'OPERADOR1',
    });
  });

  it('rejeita payload que mistura resultado numérico e opção tabelada', () => {
    expect(() => buildQualityResultPayload({
      nrFicha: 64378, codExame: 1845, codComponente: 3,
      resultado: 1, nrTabela: 8, seqOpcao: 1,
    }, 'OPERADOR1')).toThrowError(expect.objectContaining({
      status: 400, code: 'invalid-request',
    }));
  });

  it('encaminha laudo não vazio como a única representação do tipoResultado 3', () => {
    expect(buildQualityResultPayload({
      nrFicha: 64391, codExame: 2000, codComponente: 10, laudo: ' 0 ',
    }, 'Mjocelio')).toEqual({
      nrFicha: 64391, codExame: 2000, codComponente: 10,
      laudo: '0', codUsuario: 'Mjocelio',
    });

    expect(() => buildQualityResultPayload({
      nrFicha: 64391, codExame: 2000, codComponente: 10,
      resultado: 0, laudo: '0',
    }, 'Mjocelio')).toThrowError(expect.objectContaining({
      status: 400, code: 'invalid-request',
    }));
  });

  it('instala rota Express autenticada, no-store e com método fechado', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      total: 1, hasNext: false, items: [{ 'ds-ordem-producao': { ordem: [] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'OPERADOR1', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.qualityControl],
      ttlMs: 60_000, now: new Date(),
    });

    const success = await fetch(`${root}/orders/372562`, {
      headers: { authorization: `Bearer ${issued.token}` },
    });
    const wrongMethod = await fetch(`${root}/results`, { method: 'POST' });

    expect(success.status).toBe(200);
    expect(success.headers.get('cache-control')).toBe('no-store');
    expect(String(transport.mock.calls[0][0]))
      .toBe('https://datasul.example.test/api/fcq/v1/ordens/372562');
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('PUT');
  });

  it('consulta todas as fichas pendentes com identidade e empresa definidas no servidor', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      total: 1, hasNext: false, items: [{ roteirosEmAnalise: [{
        liberada: false, componentesTotal: 1, sequenciaOperacao: 1, situacao: 2,
        nrFicha: 64382, descricaoItem: 'ALAVANCA', nrOrdemProducao: 372562,
        inspecionado: false, componentesForaFaixa: 1, narrativa: '', codItem: '30907',
      }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'Mjocelio', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.divergentRouteAuthorization],
      ttlMs: 60_000, now: new Date(),
    });

    const response = await fetch(`${root}/route-authorizations?nrOrdemProducao=372562&opCodigo=10`, {
      headers: { authorization: `Bearer ${issued.token}` },
    });

    expect(response.status).toBe(200);
    const [url, init] = transport.mock.calls[0];
    expect(String(url)).toBe(
      'https://datasul.example.test/api/fcq/v1/autorizacaoroteiros?companyId=1&codUsuario=Mjocelio&nrOrdemProducao=372562&opCodigo=10',
    );
    expect(init?.method).toBe('GET');
  });

  it('finaliza com autorização por POST usando somente nrFicha controlada pelo browser', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      total: 1, hasNext: false, items: [{ 'ds-finaliza': { roteiro: [{
        componentesTotal: 1, situacao: 4, componentesSalvos: 1, nrFicha: 64461,
        mensagem: 'Finalizado', inspecionado: true, componentesForaFaixa: 1,
        finalizado: true, componentesPendentes: 0, exames: [],
      }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'Mjocelio', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.divergentRouteAuthorization],
      ttlMs: 60_000, now: new Date(),
    });

    const response = await fetch(`${root}/route-authorizations/finalize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nrFicha: 64461, codUsuario: 'NAO_CONFIAR', companyId: 999 }),
    });

    expect(response.status).toBe(200);
    const [url, init] = transport.mock.calls[0];
    expect(String(url)).toBe(
      'https://datasul.example.test/api/fcq/v1/finalizaroteirosautorizado?companyId=1',
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ nrFicha: 64461, codUsuario: 'Mjocelio' });
  });

  it('sanitiza envelope inválido do Datasul antes de responder ao browser', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      total: 1, hasNext: false, items: [{ roteirosEmAnalise: [{ nrFicha: 64382 }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'Mjocelio', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.divergentRouteAuthorization],
      ttlMs: 60_000, now: new Date(),
    });

    const response = await fetch(`${root}/route-authorizations?nrOrdemProducao=372562&opCodigo=10`, {
      headers: { authorization: `Bearer ${issued.token}` },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code: 'invalid-upstream-response' });
  });

  it('nega as rotas de autorização para sessão que possui somente fcq-0001', async () => {
    const transport = vi.fn<typeof fetch>();
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'OPERADOR1', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.qualityControl], ttlMs: 60_000, now: new Date(),
    });

    const response = await fetch(`${root}/route-authorizations?nrOrdemProducao=372562&opCodigo=10`, {
      headers: { authorization: `Bearer ${issued.token}` },
    });
    const finalization = await fetch(`${root}/route-authorizations/finalize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nrFicha: 64461 }),
    });

    expect(response.status).toBe(403);
    expect(finalization.status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it('busca o roteiro autorizado com empresa e identidade definidas no servidor', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      total: 2, hasNext: false, items: [
        { nrFicha: 64461, 'ds-roteiro': { exames: [] } },
        { nrFicha: 64462, 'ds-roteiro': { exames: [] } },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'Mjocelio', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.divergentRouteAuthorization],
      ttlMs: 60_000, now: new Date(),
    });

    const response = await fetch(`${root}/route-authorizations/route`, {
      method: 'POST',
      headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        nrFicha: 64462, nrOrdemProducao: 372562, codOperacao: 10,
        companyId: 999, codUsuario: 'NAO_CONFIAR',
      }),
    });

    expect(response.status).toBe(200);
    expect(String(transport.mock.calls[0][0])).toBe(
      'https://datasul.example.test/api/fcq/v1/roteiros?companyid=1',
    );
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      nrOrdemProducao: 372562, codOperacao: 10,
    });
    await expect(response.json()).resolves.toEqual({
      total: 1, hasNext: false, items: [{ nrFicha: 64462, 'ds-roteiro': { exames: [] } }],
    });
  });

  it.each([
    ['não encontrada', [{ nrFicha: 64461, 'ds-roteiro': { exames: [] } }]],
    ['duplicada', [
      { nrFicha: 64462, 'ds-roteiro': { exames: [] } },
      { nrFicha: 64462, 'ds-roteiro': { exames: [] } },
    ]],
  ])('recusa ficha autorizada %s', async (_caseName, items) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      total: items.length, hasNext: false, items,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'Mjocelio', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.divergentRouteAuthorization],
      ttlMs: 60_000, now: new Date(),
    });

    const response = await fetch(`${root}/route-authorizations/route`, {
      method: 'POST',
      headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nrFicha: 64462, nrOrdemProducao: 372562, codOperacao: 10 }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code: 'invalid-upstream-response' });
  });

  it('salva resultado autorizado nas três representações e deriva codUsuario da sessão', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      total: 1, hasNext: false, items: [{
        nrFicha: 64462, codExame: 1845, codComponente: 3,
        resultado: 1, dentroFaixa: true, componentesSalvos: 1, componentesTotal: 2,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const root = await startGateway(transport);
    const issued = await createAppSessionToken({
      subject: 'Mjocelio', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.divergentRouteAuthorization],
      ttlMs: 60_000, now: new Date(),
    });

    for (const payload of [
      { resultado: 24.01 },
      { nrTabela: 8, seqOpcao: 1 },
      { laudo: '  aprovado ' },
    ]) {
      const response = await fetch(`${root}/route-authorizations/results`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          nrFicha: 64462, codExame: 1845, codComponente: 3,
          codUsuario: 'NAO_CONFIAR', companyId: 999, ...payload,
        }),
      });
      expect(response.status).toBe(200);
    }

    expect(transport.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { nrFicha: 64462, codExame: 1845, codComponente: 3, resultado: 24.01, codUsuario: 'Mjocelio' },
      { nrFicha: 64462, codExame: 1845, codComponente: 3, nrTabela: 8, seqOpcao: 1, codUsuario: 'Mjocelio' },
      { nrFicha: 64462, codExame: 1845, codComponente: 3, laudo: 'aprovado', codUsuario: 'Mjocelio' },
    ]);
  });

  it('mantém análise autorizada isolada de token fcq-0001, representação mista e método errado', async () => {
    const transport = vi.fn<typeof fetch>();
    const root = await startGateway(transport);
    const fcq0001 = await createAppSessionToken({
      subject: 'OPERADOR1', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.qualityControl], ttlMs: 60_000, now: new Date(),
    });
    const fcq0002 = await createAppSessionToken({
      subject: 'OPERADOR1', secret: ENV.APP_AUTH_TOKEN_SECRET,
      permissions: [APP_PERMISSIONS.divergentRouteAuthorization], ttlMs: 60_000, now: new Date(),
    });

    const forbidden = await fetch(`${root}/route-authorizations/route`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fcq0001.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nrFicha: 64462, nrOrdemProducao: 372562, codOperacao: 10 }),
    });
    const mixed = await fetch(`${root}/route-authorizations/results`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${fcq0002.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        nrFicha: 64462, codExame: 1845, codComponente: 3,
        resultado: 1, nrTabela: 8, seqOpcao: 1,
      }),
    });
    const wrongMethod = await fetch(`${root}/route-authorizations/results`, { method: 'POST' });

    expect(forbidden.status).toBe(403);
    expect(mixed.status).toBe(400);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('PUT');
    expect(transport).not.toHaveBeenCalled();
  });
});
