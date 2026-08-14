import type { EventEmitter } from 'node:events';

import type { ApplicationLogger } from './logging/log-contracts';
import { sanitizeLogMetadata } from './logging/log-sanitizer';

export interface ManagedHttpServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
}

export interface ServerProcessTarget extends Pick<EventEmitter, 'once'> {
  exit(code: number): never | void;
}

export interface ServerLifecycleOptions {
  readonly processTarget?: ServerProcessTarget;
  readonly shutdownTimeoutMs?: number;
}

export function installServerLifecycle(
  server: ManagedHttpServer,
  logger: ApplicationLogger,
  options: ServerLifecycleOptions = {},
): () => Promise<void> {
  const processTarget = options.processTarget ?? process;
  const timeoutMs = options.shutdownTimeoutMs ?? 2_000;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (exitCode = 0, reason = 'requested'): Promise<void> => shutdownPromise ??= (async () => {
    logger.info('server_shutdown_started', sanitizeLogMetadata({ reason, exitCode }));
    await closeServerWithin(server, timeoutMs);
    await logger.close();
    processTarget.exit(exitCode);
  })();

  processTarget.once('SIGINT', () => { void shutdown(130, 'sigint'); });
  processTarget.once('SIGTERM', () => { void shutdown(143, 'sigterm'); });
  processTarget.once('uncaughtException', () => {
    logger.error('server_fatal_error', { failureCategory: 'uncaught_exception' });
    void shutdown(1, 'uncaught_exception');
  });
  processTarget.once('unhandledRejection', () => {
    logger.error('server_fatal_error', { failureCategory: 'unhandled_rejection' });
    void shutdown(1, 'unhandled_rejection');
  });

  return () => shutdown(0, 'manual');
}

function closeServerWithin(server: ManagedHttpServer, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    timeout.unref?.();
    try {
      server.close(() => finish());
    } catch {
      finish();
    }
  });
}
