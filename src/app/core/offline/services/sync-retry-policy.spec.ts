import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SYNC_SCHEDULER_CONFIG,
  SyncTimeoutError,
  assertValidSyncSchedulerConfig,
  calculateRetryDelay,
  normalizeCommandError,
} from '../models/sync-error';

describe('sync retry policy', () => {
  it('calcula full jitter exponencial com random injetado e cap configurável', () => {
    const config = { ...DEFAULT_SYNC_SCHEDULER_CONFIG, baseDelayMs: 1_000, maxDelayMs: 5_000 };

    expect(calculateRetryDelay(1, 0.5, config)).toBe(500);
    expect(calculateRetryDelay(2, 0.5, config)).toBe(1_000);
    expect(calculateRetryDelay(10, 0.5, config)).toBe(2_500);
    expect(calculateRetryDelay(10, 1, config)).toBe(5_000);
    expect(calculateRetryDelay(1, 0, config)).toBe(1);
  });

  it('usa Retry-After válido como piso sem alterar a identidade do comando', () => {
    const config = { ...DEFAULT_SYNC_SCHEDULER_CONFIG, baseDelayMs: 1_000, maxDelayMs: 5_000 };

    expect(calculateRetryDelay(2, 0.25, config, 10)).toBe(10_000);
    expect(calculateRetryDelay(2, 0.25, config, -1)).toBe(500);
    expect(calculateRetryDelay(2, 0.25, config, Number.NaN)).toBe(500);
    expect(
      normalizeCommandError({
        status: 429,
        retryAfterSeconds: Number.MAX_VALUE,
      }),
    ).not.toHaveProperty('retryAfterSeconds');
  });

  it.each([
    [new TypeError('Failed to fetch payload secreto'), 'NETWORK', 'TRANSIENT'],
    [new SyncTimeoutError(), 'TIMEOUT', 'TRANSIENT'],
    [{ status: 408 }, 'HTTP_408', 'TRANSIENT'],
    [{ status: 429, retryAfterSeconds: 12 }, 'HTTP_429', 'TRANSIENT'],
    [{ status: 503 }, 'HTTP_503', 'TRANSIENT'],
    [{ status: 401 }, 'HTTP_401', 'AUTH'],
    [{ status: 403 }, 'HTTP_403', 'VALIDATION'],
    [{ status: 422 }, 'HTTP_422', 'VALIDATION'],
  ])('normaliza %o como %s/%s', (failure, code, category) => {
    expect(normalizeCommandError(failure)).toMatchObject({ code, category });
  });

  it('respeita categoria explícita do contrato antes do fallback HTTP', () => {
    expect(
      normalizeCommandError({
        status: 409,
        code: 'PROCESSING',
        category: 'TRANSIENT',
        userMessage: 'Comando ainda em processamento.',
        correlationId: 'corr-1',
        retryAfterSeconds: 2,
      }),
    ).toEqual({
      code: 'PROCESSING',
      category: 'TRANSIENT',
      userMessage: 'Comando ainda em processamento.',
      correlationId: 'corr-1',
      retryAfterSeconds: 2,
    });
  });

  it('sanitiza código, correlação e mensagem sem copiar segredo ou Error.message', () => {
    const normalized = normalizeCommandError({
      status: 400,
      code: 'BAD\nCODE',
      category: 'VALIDATION',
      userMessage: 'senha=super-secreta token=abc',
      correlationId: 'corr\nunsafe',
    });
    const unknown = normalizeCommandError(new Error('cookie=privado payload secreto'));

    expect(normalized).toEqual({
      code: 'INVALID_CODE',
      category: 'VALIDATION',
      userMessage: 'O comando foi rejeitado e precisa de correção.',
    });
    expect(JSON.stringify(unknown)).not.toContain('privado');
    expect(JSON.stringify(unknown)).not.toContain('payload secreto');
  });

  it.each(['apiKey=abc', 'access_key=abc', 'private-key=abc', 'jwt=abc', 'supervisorPin=1234'])(
    'não persiste mensagem contendo segredo alternativo: %s',
    (userMessage) => {
      expect(
        normalizeCommandError({ status: 422, category: 'VALIDATION', userMessage }),
      ).toMatchObject({
        userMessage: 'O comando foi rejeitado e precisa de correção.',
      });
    },
  );

  it('rejeita configuração cujo lease não cobre o timeout remoto', () => {
    expect(() =>
      assertValidSyncSchedulerConfig({
        ...DEFAULT_SYNC_SCHEDULER_CONFIG,
        requestTimeoutMs: 60_000,
        leaseDurationMs: 60_000,
      }),
    ).toThrowError(/scheduler/i);
  });

  it('expõe baseline operacional readonly da story', () => {
    expect(DEFAULT_SYNC_SCHEDULER_CONFIG).toMatchObject({
      baseDelayMs: 1_000,
      maxDelayMs: 300_000,
      requestTimeoutMs: 30_000,
      leaseDurationMs: 60_000,
    });
    expect(Object.isFrozen(DEFAULT_SYNC_SCHEDULER_CONFIG)).toBe(true);
  });
});
