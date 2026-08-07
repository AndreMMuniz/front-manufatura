// @vitest-environment node

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthLoginError } from './auth-login';
import { installAuthLoginEndpoint } from './auth-http-endpoint';

const ENV = { DATASUL_BASE_URL: 'https://datasul.example.test' };
const SUCCESS = {
  token: 'app-token',
  tokenExpiresAt: '2026-08-07T12:01:00.000Z',
  usuario: {
    id: 'operador', nome: 'Operador', login: 'operador',
    permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
  },
};

type RunningServer = ReturnType<ReturnType<typeof express>['listen']>;
const servers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(error => error ? reject(error) : resolve());
  })));
});

async function start(authenticate = vi.fn().mockResolvedValue(SUCCESS)) {
  const app = express();
  installAuthLoginEndpoint(app, { env: ENV, authenticate });
  let server!: RunningServer;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { authenticate, url: `http://127.0.0.1:${port}/api/auth/login` };
}

describe('/api/auth/login', () => {
  it('responde sucesso assíncrono com no-store e repassa somente o body validado', async () => {
    const { authenticate, url } = await start();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: ' operador ', senha: ' literal ' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(SUCCESS);
    expect(authenticate).toHaveBeenCalledWith(
      { login: ' operador ', senha: ' literal ' },
      ENV,
    );
  });

  it('rejeita método diferente de POST antes do parser', async () => {
    const { authenticate, url } = await start();
    const response = await fetch(url, { method: 'PUT', body: '{invalido' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'method-not-allowed' });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('sanitiza JSON malformado e body não objeto', async () => {
    const first = await start();
    const malformed = await fetch(first.url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalido',
    });
    const second = await start();
    const primitive = await fetch(second.url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '"texto"',
    });

    for (const response of [malformed, primitive]) {
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ code: 'invalid-request' });
    }
    expect(first.authenticate).not.toHaveBeenCalled();
    expect(second.authenticate).not.toHaveBeenCalled();
  });

  it('rejeita payload acima de 16 KB sem ecoar conteúdo', async () => {
    const { authenticate, url } = await start();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'operador', senha: 'x'.repeat(17 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'request-too-large' });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'invalid-credentials'],
    [403, 'access-denied'],
    [502, 'datasul-unavailable'],
    [502, 'invalid-upstream-response'],
    [503, 'auth-gateway-not-configured'],
    [504, 'datasul-timeout'],
  ] as const)('mapeia erro público %i %s sem detalhes internos', async (status, code) => {
    const authenticate = vi.fn().mockRejectedValue(new AuthLoginError(status, code));
    const endpoint = await start(authenticate);
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'operador', senha: 'literal' }),
    });

    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code });
  });

  it('captura falha inesperada sem stack, HTML ou mensagem bruta', async () => {
    const endpoint = await start(vi.fn().mockRejectedValue(new Error('segredo interno')));
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'operador', senha: 'literal' }),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ code: 'datasul-unavailable' });
  });
});
