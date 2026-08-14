import type { ApplicationLogger } from './logging/log-contracts';
import { sanitizeLogMetadata } from './logging/log-sanitizer';
import { getRequestCorrelationId } from './server-observability';

export interface UpstreamRequestDetails {
  readonly system: 'datasul';
  readonly operation: string;
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly route: string;
  readonly protocol?: 'http:' | 'https:';
  readonly destinationHost?: string;
}

const responseDurations = new WeakMap<Response, number>();

export async function observeUpstreamFetch(
  logger: ApplicationLogger,
  details: UpstreamRequestDetails,
  request: () => Promise<Response>,
  clock: () => number = () => performance.now(),
): Promise<Response> {
  const start = clock();
  const common = sanitizeLogMetadata({
    correlationId: getRequestCorrelationId(),
    upstreamSystem: details.system,
    operation: details.operation,
    method: details.method,
    route: details.route,
    protocol: details.protocol,
    destinationHost: details.destinationHost,
  });
  logger.info('upstream_request_started', common);
  try {
    const response = await request();
    const durationMs = duration(clock() - start);
    responseDurations.set(response, durationMs);
    if (!response.ok) {
      logger.warn('upstream_request_failed', sanitizeLogMetadata({
        ...common, status: response.status, failureCategory: 'http_status', durationMs,
      }));
    }
    return response;
  } catch (error) {
    logger.warn('upstream_request_failed', sanitizeLogMetadata({
      ...common,
      failureCategory: failureCategory(error),
      durationMs: duration(clock() - start),
    }));
    throw error;
  }
}

export function reportUpstreamRequestCompleted(
  logger: ApplicationLogger,
  details: UpstreamRequestDetails,
  response: Response,
): void {
  logger.info('upstream_request_completed', responseMetadata(details, response, {
    outcome: 'success',
  }));
}

export function reportInvalidUpstreamResponse(
  logger: ApplicationLogger,
  details: UpstreamRequestDetails,
  response: Response,
): void {
  logger.warn('upstream_request_failed', responseMetadata(details, response, {
    failureCategory: 'invalid_response',
  }));
}

export function reportUpstreamResponseFailure(
  logger: ApplicationLogger,
  details: UpstreamRequestDetails,
  response: Response,
  error: unknown,
): void {
  logger.warn('upstream_request_failed', responseMetadata(details, response, {
    failureCategory: failureCategory(error, 'invalid_response'),
  }));
}

function failureCategory(
  error: unknown,
  fallback: 'unknown' | 'invalid_response' = 'unknown',
): 'timeout' | 'network' | 'unknown' | 'invalid_response' {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  return error instanceof TypeError && fallback === 'unknown' ? 'network' : fallback;
}

function duration(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function responseMetadata(
  details: UpstreamRequestDetails,
  response: Response,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeLogMetadata({
    correlationId: getRequestCorrelationId(),
    upstreamSystem: details.system,
    operation: details.operation,
    method: details.method,
    route: details.route,
    protocol: details.protocol,
    destinationHost: details.destinationHost,
    status: response.status,
    durationMs: responseDurations.get(response),
    ...extra,
  });
}
