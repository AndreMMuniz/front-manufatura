import express, {
  type Application,
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
} from 'express';

import {
  CLIENT_LOG_BODY_LIMIT_BYTES,
  validateClientLogEvent,
} from './logging/client-log-contracts';
import type { AppLogLevel, ApplicationLogger, LogMetadata } from './logging/log-contracts';
import { sanitizeLogMetadata } from './logging/log-sanitizer';
import { getRequestCorrelationId } from './server-observability';

const CLIENT_LOG_PATH = '/api/client-logs';
const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 60;
const MAX_BUCKETS = 10_000;

interface RateBucket {
  readonly startedAt: number;
  count: number;
}

export interface ClientLogEndpointDependencies {
  readonly logger: ApplicationLogger;
  readonly clock?: () => number;
}

export function installClientLogEndpoint(
  app: Application,
  dependencies: ClientLogEndpointDependencies,
): void {
  const clock = dependencies.clock ?? Date.now;
  const buckets = new Map<string, RateBucket>();

  app.use(CLIENT_LOG_PATH, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(CLIENT_LOG_PATH, createRateLimiter(buckets, clock));
  app.all(CLIENT_LOG_PATH, (req, res, next) => {
    if (req.method === 'POST') {
      next();
      return;
    }
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method-not-allowed' });
  });
  app.use(CLIENT_LOG_PATH, express.json({
    limit: CLIENT_LOG_BODY_LIMIT_BYTES,
    type: '*/*',
  }));
  app.post(CLIENT_LOG_PATH, (req, res) => {
    const validation = validateClientLogEvent(req.body);
    if (!validation.ok) {
      res.status(400).json({ code: 'invalid-request' });
      return;
    }

    const clientEvent = validation.event;
    const metadata = sanitizeLogMetadata({
      category: clientEvent.category,
      clientTimestamp: clientEvent.timestamp,
      ...(clientEvent.message !== undefined ? { clientMessage: clientEvent.message } : {}),
      ...(clientEvent.stack !== undefined ? { clientStack: clientEvent.stack } : {}),
      correlationId: getRequestCorrelationId() ?? clientEvent.correlationId,
      ...(clientEvent.context ?? {}),
    });
    bestEffortWrite(dependencies.logger, clientEvent.level, clientEvent.event, metadata);
    res.status(204).end();
  });

  const parserError: ErrorRequestHandler = (error, _req, res, next) => {
    const candidate = typeof error === 'object' && error !== null
      ? error as { status?: unknown; type?: unknown }
      : {};
    if (candidate.status === 413 || candidate.type === 'entity.too.large') {
      res.status(413).json({ code: 'request-too-large' });
      return;
    }
    if (candidate.status === 400 || candidate.type === 'entity.parse.failed') {
      res.status(400).json({ code: 'invalid-request' });
      return;
    }
    next(error);
  };
  app.use(CLIENT_LOG_PATH, parserError);
}

function createRateLimiter(
  buckets: Map<string, RateBucket>,
  clock: () => number,
): RequestHandler {
  return (req, res, next) => {
    const now = safeNow(clock);
    removeExpiredBuckets(buckets, now);
    const ip = clientIp(req);
    let bucket = buckets.get(ip);
    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) {
        rejectRateLimited(resWithRetry(res, 60));
        return;
      }
      bucket = { startedAt: now, count: 0 };
      buckets.set(ip, bucket);
    }
    if (bucket.count >= REQUESTS_PER_WINDOW) {
      const seconds = Math.max(1, Math.ceil((bucket.startedAt + WINDOW_MS - now) / 1_000));
      rejectRateLimited(resWithRetry(res, seconds));
      return;
    }
    bucket.count += 1;
    next();
  };
}

function removeExpiredBuckets(buckets: Map<string, RateBucket>, now: number): void {
  for (const [ip, bucket] of buckets) {
    if (now - bucket.startedAt >= WINDOW_MS) buckets.delete(ip);
  }
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function safeNow(clock: () => number): number {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function resWithRetry<T extends { setHeader(name: string, value: string | number): unknown }>(
  res: T,
  seconds: number,
): T {
  res.setHeader('Retry-After', seconds);
  return res;
}

function rejectRateLimited(
  res: { status(code: number): { json(body: unknown): unknown } },
): void {
  res.status(429).json({ code: 'rate-limit-exceeded' });
}

function bestEffortWrite(
  logger: ApplicationLogger,
  level: AppLogLevel,
  event: string,
  metadata: LogMetadata,
): void {
  try {
    logger[level](event, metadata);
  } catch {
    // Client telemetry must never affect the primary operation.
  }
}
