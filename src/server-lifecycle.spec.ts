import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import type { ApplicationLogger } from './logging/log-contracts';
import { installServerLifecycle } from './server-lifecycle';

function logger() {
  return {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn(async () => undefined),
  } satisfies ApplicationLogger;
}

function runtime() {
  return Object.assign(new EventEmitter(), {
    exit: vi.fn((_code: number) => undefined),
  });
}

describe('server lifecycle', () => {
  it('não instala handlers antes da chamada explícita e encerra SIGTERM com código 143', async () => {
    const processTarget = runtime();
    const target = logger();
    const server = { close: vi.fn((callback: (error?: Error) => void) => callback()), closeAllConnections: vi.fn() };
    expect(processTarget.listenerCount('SIGTERM')).toBe(0);

    installServerLifecycle(server, target, { processTarget, shutdownTimeoutMs: 50 });
    expect(processTarget.listenerCount('SIGTERM')).toBe(1);
    processTarget.emit('SIGTERM');
    await vi.waitFor(() => expect(processTarget.exit).toHaveBeenCalledWith(143));
    expect(target.close).toHaveBeenCalledOnce();
  });

  it('encerra fatalmente e não volta a operar após uncaughtException', async () => {
    const processTarget = runtime();
    const target = logger();
    const server = { close: vi.fn((callback: (error?: Error) => void) => callback()), closeAllConnections: vi.fn() };
    installServerLifecycle(server, target, { processTarget, shutdownTimeoutMs: 50 });

    processTarget.emit('uncaughtException', new Error('senha=segredo'));
    await vi.waitFor(() => expect(processTarget.exit).toHaveBeenCalledWith(1));
    expect(target.error).toHaveBeenCalledWith('server_fatal_error', expect.objectContaining({
      failureCategory: 'uncaught_exception',
      error: expect.objectContaining({ name: 'Error', message: '[REDACTED]' }),
    }));
    expect(JSON.stringify(target.error.mock.calls)).not.toContain('segredo');
  });

  it('é idempotente mesmo com múltiplos sinais', async () => {
    const processTarget = runtime();
    const target = logger();
    const server = { close: vi.fn((callback: (error?: Error) => void) => callback()), closeAllConnections: vi.fn() };
    installServerLifecycle(server, target, { processTarget, shutdownTimeoutMs: 50 });

    processTarget.emit('SIGINT');
    processTarget.emit('SIGTERM');
    await vi.waitFor(() => expect(processTarget.exit).toHaveBeenCalledOnce());
    expect(server.close).toHaveBeenCalledOnce();
    expect(target.close).toHaveBeenCalledOnce();
  });

  it('encerra mesmo quando o fechamento do logger rejeita', async () => {
    const processTarget = runtime();
    const target = logger();
    target.close.mockRejectedValueOnce(new Error('disk failure'));
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => callback()), closeAllConnections: vi.fn(),
    };
    installServerLifecycle(server, target, { processTarget, shutdownTimeoutMs: 50 });

    processTarget.emit('SIGTERM');
    await vi.waitFor(() => expect(processTarget.exit).toHaveBeenCalledWith(143));
  });
});
