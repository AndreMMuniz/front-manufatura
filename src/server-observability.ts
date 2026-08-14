import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { ErrorRequestHandler, Request, RequestHandler } from 'express';

import type { ApplicationLogger } from './logging/log-contracts';
import { sanitizeLogMetadata } from './logging/log-sanitizer';

export interface RequestLogContext {
  readonly correlationId: string;
}

export interface RequestObservabilityDependencies {
  readonly createId?: () => string;
  readonly clock?: () => number;
}

const contexts = new AsyncLocalStorage<RequestLogContext>();
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function getRequestCorrelationId(): string | undefined {
  return contexts.getStore()?.correlationId;
}

export function requestObservabilityMiddleware(
  logger: ApplicationLogger,
  dependencies: RequestObservabilityDependencies = {},
): RequestHandler {
  const createId = dependencies.createId ?? randomUUID;
  const clock = dependencies.clock ?? (() => performance.now());
  return (req, res, next) => {
    const correlationId = safeCorrelationId(req.header('x-correlation-id')) ?? createId();
    const start = clock();
    let recorded = false;
    res.setHeader('X-Correlation-Id', correlationId);

    const record = (completed: boolean) => {
      if (recorded) return;
      recorded = true;
      const metadata = sanitizeLogMetadata({
        correlationId,
        method: req.method,
        route: normalizedRoute(req),
        status: res.statusCode,
        durationMs: Math.max(0, Math.round((clock() - start) * 100) / 100),
      });
      if (!completed) {
        logger.warn('api_request_aborted', metadata);
      } else if (res.statusCode >= 500) {
        logger.error('api_request_completed', metadata);
      } else if (res.statusCode >= 400) {
        logger.warn('api_request_completed', metadata);
      } else {
        logger.info('api_request_completed', metadata);
      }
    };
    res.once('finish', () => record(true));
    res.once('close', () => record(res.writableEnded));
    contexts.run({ correlationId }, next);
  };
}

export function serverErrorHandler(logger: ApplicationLogger): ErrorRequestHandler {
  return (error, req, res, next) => {
    logger.error('api_request_unhandled_error', sanitizeLogMetadata({
      correlationId: getRequestCorrelationId(),
      method: req.method,
      route: normalizedRoute(req),
      error,
    }));
    if (res.headersSent || !isApiRequest(req)) {
      next(error);
      return;
    }
    res.status(500).json({ code: 'internal-error' });
  };
}

export function normalizedRoute(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof routePath === 'string') {
    return joinRoute(req.baseUrl, routePath);
  }
  return maskDynamicSegments(req.path || '/');
}

function safeCorrelationId(value: string | undefined): string | undefined {
  return value && SAFE_CORRELATION_ID.test(value) ? value : undefined;
}

function joinRoute(baseUrl: string, path: string): string {
  const joined = `${baseUrl}/${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

function maskDynamicSegments(path: string): string {
  return path.split('/').map(segment => {
    if (/^\d+$/.test(segment)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return ':id';
    if (segment !== 'v1' && /\d/.test(segment)) return ':id';
    return segment;
  }).join('/');
}

function isApiRequest(req: Request): boolean {
  return req.path === '/api' || req.path.startsWith('/api/');
}
