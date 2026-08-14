import { ErrorHandler } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientErrorHandler } from './client-error-handler';
import type { ClientLogService } from './client-log.service';

describe('ClientErrorHandler', () => {
  const originalConsoleError = console.error;

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('captura somente campos seguros e mantém o reporte padrão exatamente uma vez', () => {
    const capture = vi.fn();
    console.error = vi.fn();
    const handler = new ClientErrorHandler({ capture } as unknown as ClientLogService);
    const error = new Error('Bearer segredo; falha visível');
    error.stack = 'senha=segredo; stack segura';
    Object.assign(error, { code: 'UI_FAILURE', body: { resultado: 346 } });

    handler.handleError(error);

    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith({
      level: 'error', category: 'browser', event: 'angular_error',
      message: '[REDACTED]; falha visível', stack: '[REDACTED]; stack segura',
      context: { code: 'UI_FAILURE' },
    });
    expect(console.error).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith('ERROR', error);
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/346|segredo/);
  });

  it('não avalia getters e chama super mesmo quando a coleta lança', () => {
    const candidate = Object.defineProperties({}, {
      message: { enumerable: true, get: () => { throw new Error('getter'); } },
      stack: { enumerable: true, get: () => { throw new Error('getter'); } },
    });
    const capture = vi.fn(() => { throw new Error('sink'); });
    console.error = vi.fn();
    const handler = new ClientErrorHandler({ capture } as unknown as ClientLogService);

    expect(() => handler.handleError(candidate)).not.toThrow();
    expect(capture).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('continua sendo uma especialização do ErrorHandler do Angular', () => {
    const handler = new ClientErrorHandler({ capture: vi.fn() } as unknown as ClientLogService);
    expect(handler).toBeInstanceOf(ErrorHandler);
  });
});
