// @vitest-environment node

import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApplicationLogger } from './logging/log-contracts';
import {
  getRequestCorrelationId,
  requestObservabilityMiddleware,
  serverErrorHandler,
} from './server-observability';

type RunningServer = ReturnType<ReturnType<typeof express>['listen']>;
const servers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    if (!server.listening) { resolve(); return; }
    server.close(error => error ? reject(error) : resolve());
  })));
});

function logger() {
  const events: Array<{ level: string; event: string; metadata?: Record<string, unknown> }> = [];
  const make = (level: string) => (event: string, metadata?: Record<string, unknown>) => {
    events.push({ level, event, metadata });
  };
  return {
    events,
    value: {
      debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error'),
      close: () => Promise.resolve(),
    } satisfies ApplicationLogger,
  };
}

async function start(app: ReturnType<typeof express>): Promise<string> {
  let server!: RunningServer;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('server request observability', () => {
  it('preserva correlação válida e registra rota dinâmica sem query ou identificador', async () => {
    const sink = logger();
    const app = express();
    app.use(requestObservabilityMiddleware(sink.value, {
      createId: () => 'generated-id', clock: (() => { let value = 10; return () => value += 5; })(),
    }));
    app.get('/api/orders/:id', (_req, res) => res.status(201).json({ ok: true }));
    const root = await start(app);

    const response = await fetch(`${root}/api/orders/372562?token=segredo`, {
      headers: { 'x-correlation-id': 'corr-valid-1' },
    });

    expect(response.headers.get('x-correlation-id')).toBe('corr-valid-1');
    expect(sink.events).toContainEqual(expect.objectContaining({
      event: 'api_request_completed',
      metadata: expect.objectContaining({
        correlationId: 'corr-valid-1', method: 'GET', route: '/api/orders/:id',
        status: 201, durationMs: 5,
      }),
    }));
    expect(JSON.stringify(sink.events)).not.toMatch(/372562|token|segredo/);
  });

  it('substitui correlação inválida e responde erro API sanitizado', async () => {
    const sink = logger();
    const app = express();
    app.use(requestObservabilityMiddleware(sink.value, { createId: () => 'safe-generated' }));
    app.get('/api/failure', () => { throw new Error('senha=segredo'); });
    app.use(serverErrorHandler(sink.value));
    const root = await start(app);

    const response = await fetch(`${root}/api/failure`, {
      headers: { 'x-correlation-id': 'invalid header with spaces' },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('x-correlation-id')).toBe('safe-generated');
    expect(await response.json()).toEqual({ code: 'internal-error' });
    expect(JSON.stringify(sink.events)).not.toContain('segredo');
  });

  it('isola duas requisições concorrentes no AsyncLocalStorage', async () => {
    const sink = logger();
    const app = express();
    app.use(requestObservabilityMiddleware(sink.value));
    app.get('/api/context/:delay', async (req, res) => {
      await new Promise(resolve => setTimeout(resolve, Number(req.params['delay'])));
      res.json({ correlationId: getRequestCorrelationId() });
    });
    const root = await start(app);

    const [slow, fast] = await Promise.all([
      fetch(`${root}/api/context/15`, { headers: { 'x-correlation-id': 'slow-correlation' } }),
      fetch(`${root}/api/context/1`, { headers: { 'x-correlation-id': 'fast-correlation' } }),
    ]);

    await expect(slow.json()).resolves.toEqual({ correlationId: 'slow-correlation' });
    await expect(fast.json()).resolves.toEqual({ correlationId: 'fast-correlation' });
  });

  it('emite somente um evento quando finish e close ocorrem', () => {
    const sink = logger();
    const listeners = new Map<string, () => void>();
    const response = {
      statusCode: 204,
      setHeader: vi.fn(),
      once: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)),
    };
    const request = {
      method: 'HEAD', path: '/api/health', headers: {}, baseUrl: '',
      header: vi.fn(() => undefined),
    };
    const next = vi.fn();

    requestObservabilityMiddleware(sink.value, { createId: () => 'health-id', clock: () => 10 })(
      request as never, response as never, next,
    );
    listeners.get('finish')?.();
    listeners.get('close')?.();

    expect(sink.events).toHaveLength(1);
  });
});
