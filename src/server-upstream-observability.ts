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
  logger.debug('upstream_request_started', common);
  try {
    const response = await request();
    const metadata = sanitizeLogMetadata({
      ...common,
      status: response.status,
      outcome: response.ok ? 'success' : 'http_error',
      durationMs: duration(clock() - start),
    });
    (response.ok ? logger.info : logger.warn)('upstream_request_completed', metadata);
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

export function reportInvalidUpstreamResponse(
  logger: ApplicationLogger,
  details: UpstreamRequestDetails,
  status: number,
): void {
  logger.warn('upstream_response_invalid', sanitizeLogMetadata({
    correlationId: getRequestCorrelationId(),
    upstreamSystem: details.system,
    operation: details.operation,
    method: details.method,
    route: details.route,
    protocol: details.protocol,
    destinationHost: details.destinationHost,
    status,
    failureCategory: 'invalid_response',
  }));
}

function failureCategory(error: unknown): 'timeout' | 'network' | 'unknown' {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  return error instanceof TypeError ? 'network' : 'unknown';
}

function duration(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}
