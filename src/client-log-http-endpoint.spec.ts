// @vitest-environment node

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installClientLogEndpoint } from './client-log-http-endpoint';
import type { ApplicationLogger } from './logging/log-contracts';
import { requestObservabilityMiddleware } from './server-observability';

type RunningServer = ReturnType<ReturnType<typeof express>['listen'];
const servers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    if (!server.listening) { resolve(); return; }
    server.close(error => error ? reject(error) : resolve());
  })));
});

function logger(throws = false) {
  const writes: Array<{ level: string; event: string; metadata?: Record<string, unknown> }> = [];
  const write = (level: string) => (event: string, metadata?: Record<string, unknown>) => {
    if (throws) throw new Error('logger indisponível');
    writes.push({ level, event, metadata });
  };
  return {
    writes,
    value: {
      debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error'),
      close: () => Promise.resolve(),
    } satisfies ApplicationLogger,
  };
}

const EVENT = {
  timestamp: '2026-08-14T20:00:00.000Z',
  level: 'error',
  category: 'http',
  event: 'http_request_failed',
  message: 'Bearer segredo; falha segura',
  stack: 'senha=segredo; stack segura',
  correlationId: 'corr-client-1',
  context: { method: 'POST', route: '/api/operations/start', status: 503 },
} as const;

async function start(options: { clock?: () => number; loggerThrows?: boolean } = {}) {
  const sink = logger(options.loggerThrows);
  const app = express();
  app.use(requestObservabilityMiddleware(sink.value, { createId: () => 'generated-correlation' }));
  installClientLogEndpoint(app, { logger: sink.value, clock: options.clock });
  let server!: RunningServer;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  servers.push(server);
  return {
    sink,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/client-logs`,
  };
}

async function send(url: string, body: string, init: RequestInit = {}) {
  return fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body, ...init,
  });
}

describe('/api/client-logs', () => {
  it('aceita exatamente um evento, responde 204/no-store e remapeia campos reservados', async () => {
    const endpoint = await start();
    const response = await send(endpoint.url, JSON.stringify(EVENT), {
      headers: { 'x-correlation-id': EVENT.correlationId },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(endpoint.sink.writes).toContainEqual({
      level: 'error',
      event: 'http_request_failed',
      metadata: expect.objectContaining({
        category: 'http', clientTimestamp: EVENT.timestamp,
        clientMessage: '[REDACTED]; falha segura',
        clientStack: '[REDACTED]; stack segura', correlationId: EVENT.correlationId,
        method: 'POST', route: '/api/operations/start', status: 503,
      }),
    });
    expect(JSON.stringify(endpoint.sink.writes)).not.toContain('segredo');
  });

  it('rejeita método, JSON inválido, schema aberto e payload acima de 16 KB sem eco', async () => {
    const endpoint = await start();
    const method = await fetch(endpoint.url, { method: 'PUT', body: 'senha=segredo' });
    const malformed = await send(endpoint.url, '{"senha":"segredo"');
    const schema = await send(endpoint.url, JSON.stringify({ ...EVENT, body: 'senha=segredo' }));
    const large = await send(endpoint.url, JSON.stringify({ ...EVENT, message: 'x'.repeat(17 * 1024) }));

    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST');
    for (const [response, status, code] of [
      [malformed, 400, 'invalid-request'], [schema, 400, 'invalid-request'],
      [large, 413, 'request-too-large'],
    ] as const) {
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ code });
    }
  });

  it('limita a 60 requests por janela/IP antes do método e parser e reinicia deterministicamente', async () => {
    let now = 10_000;
    const endpoint = await start({ clock: () => now });
    const responses = [];
    for (let index = 0; index < 60; index += 1) {
      responses.push(await fetch(endpoint.url, { method: 'GET' }));
    }
    expect(responses.every(response => response.status === 405)).toBe(true);

    const limited = await send(endpoint.url, JSON.stringify(EVENT));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.json()).toEqual({ code: 'rate-limit-exceeded' });

    now += 60_000;
    expect((await send(endpoint.url, JSON.stringify(EVENT))).status).toBe(204);
  });

  it('trunca textos aceitos e absorve falha do logger sem alterar o sucesso', async () => {
    const endpoint = await start({ loggerThrows: true });
    const response = await send(endpoint.url, JSON.stringify({
      ...EVENT, message: 'm'.repeat(2_000), stack: 's'.repeat(5_000),
    }));
    expect(response.status).toBe(204);
  });
});
