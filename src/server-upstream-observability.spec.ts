import { describe, expect, it } from 'vitest';

import type { ApplicationLogger } from './logging/log-contracts';
import { observeUpstreamFetch } from './server-upstream-observability';

function sink() {
  const events: Array<{ level: string; event: string; metadata?: Record<string, unknown> }> = [];
  const make = (level: string) => (event: string, metadata?: Record<string, unknown>) => {
    events.push({ level, event, metadata });
  };
  return {
    events,
    logger: {
      debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error'),
      close: () => Promise.resolve(),
    } satisfies ApplicationLogger,
  };
}

describe('upstream observability', () => {
  it('registra sucesso somente com operação e rota normalizadas', async () => {
    const target = sink();
    let time = 0;
    const response = await observeUpstreamFetch(target.logger, {
      system: 'datasul', operation: 'save_quality_result', method: 'PUT',
      route: '/api/fcq/v1/resultexames',
    }, async () => new Response('{}', { status: 201 }), () => time += 4);

    expect(response.status).toBe(201);
    expect(target.events).toEqual([
      expect.objectContaining({ level: 'debug', event: 'upstream_request_started' }),
      expect.objectContaining({
        level: 'info', event: 'upstream_request_completed',
        metadata: expect.objectContaining({ status: 201, durationMs: 4 }),
      }),
    ]);
  });

  it.each([
    [Object.assign(new Error('Bearer secret'), { name: 'TimeoutError' }), 'timeout'],
    [new TypeError('https://login:password@datasul/api?token=secret'), 'network'],
    ['raw secret response', 'unknown'],
  ])('classifica falhas sem registrar o erro bruto', async (failure, category) => {
    const target = sink();
    await expect(observeUpstreamFetch(target.logger, {
      system: 'datasul', operation: 'authenticate_user', method: 'GET',
      route: '/api/btb/v1/usuarios',
    }, async () => { throw failure; })).rejects.toBe(failure);

    expect(target.events.at(-1)).toEqual(expect.objectContaining({
      level: 'warn', event: 'upstream_request_failed',
      metadata: expect.objectContaining({ failureCategory: category }),
    }));
    expect(JSON.stringify(target.events)).not.toMatch(/secret|password|login/);
  });
});
