import type { AppLogLevel } from './log-contracts';
import { sanitizeLogMetadata, sanitizeLogText } from './log-sanitizer';

export const CLIENT_LOG_MESSAGE_LIMIT = 1_000;
export const CLIENT_LOG_STACK_LIMIT = 4_000;
export const CLIENT_LOG_BODY_LIMIT_BYTES = 16 * 1_024;
export const SAFE_CLIENT_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const CLIENT_LOG_CATEGORIES = [
  'browser', 'http', 'capability', 'synchronization',
] as const;
export type ClientLogCategory = (typeof CLIENT_LOG_CATEGORIES)[number];

export const CLIENT_LOG_EVENTS = [
  'angular_error',
  'http_request_failed',
  'identity_capability_unavailable',
  'sync_send_started',
  'sync_succeeded',
  'sync_retry_scheduled',
  'sync_blocked',
  'sync_failed',
  'sync_cycle_failed',
  'sync_storage_failed',
  'sync_request_skipped',
  'sync_no_candidates',
  'batch_report_requested',
  'batch_report_persisted',
  'batch_report_delivery_observed',
  'stop_command_persisted',
  'stop_command_delivery_observed',
] as const;
export type ClientLogEventName = (typeof CLIENT_LOG_EVENTS)[number];

export const CLIENT_HTTP_METHODS = [
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
] as const;
export type ClientHttpMethod = (typeof CLIENT_HTTP_METHODS)[number];

export const CLIENT_LOG_ROUTES = [
  '/api/auth/login',
  '/api/health',
  '/api/client-logs',
  '/api/production-areas',
  '/api/work-centers',
  '/api/operators',
  '/api/operational-responsibles',
  '/api/teams',
  '/api/teams/:code',
  '/api/scrap-reasons',
  '/api/stop-reasons',
  '/api/production-orders',
  '/api/production-orders/:order/operations/:operation',
  '/api/operations/start',
  '/api/operations/report',
  '/api/operations/end',
  '/api/batches/start',
  '/api/batches/report',
  '/api/batches/end',
  '/api/production-stops',
  '/api/production-stops/:id/finish',
  '/api/quality-control/orders/:orderNumber',
  '/api/quality-control/routes',
  '/api/quality-control/results',
  '/api/quality-control/routes/finalize',
  '/api/:unmatched',
] as const;
export type ClientLogRoute = (typeof CLIENT_LOG_ROUTES)[number];

export const CLIENT_COMMAND_TYPES = [
  'GENERATE_INSPECTION_ROUTE', 'SAVE_MEASUREMENT', 'FINISH_EXAM',
  'STOP_INSPECTION_ROUTE', 'SAVE_INSPECTION', 'SAVE_QUALITY_RESULT',
  'FINALIZE_QUALITY_ROUTE', 'START_OPERATION', 'REPORT_OPERATION',
  'END_OPERATION', 'START_BATCH', 'REPORT_BATCH', 'END_BATCH',
  'CREATE_STOP', 'FINISH_STOP',
] as const;
export type ClientCommandType = (typeof CLIENT_COMMAND_TYPES)[number];

export const CLIENT_AGGREGATE_TYPES = [
  'QUALITY_ROUTE', 'QUALITY_EXAM', 'QUALITY_INSPECTION', 'OPERATION', 'BATCH', 'STOP',
] as const;
export type ClientAggregateType = (typeof CLIENT_AGGREGATE_TYPES)[number];

export const CLIENT_SYNC_STATUSES = [
  'PENDING', 'SYNCING', 'RETRY_WAIT', 'SYNCED', 'BLOCKED_AUTH',
  'BLOCKED_DEPENDENCY', 'ERROR',
] as const;
export type ClientSyncStatus = (typeof CLIENT_SYNC_STATUSES)[number];

export const CLIENT_FAILURE_CATEGORIES = [
  'TRANSIENT', 'AUTH', 'VALIDATION', 'CONFLICT', 'CONFIGURATION',
  'HTTP', 'NETWORK', 'TIMEOUT', 'ABORT', 'STORAGE', 'UNKNOWN',
] as const;
export type ClientFailureCategory = (typeof CLIENT_FAILURE_CATEGORIES)[number];

export const CLIENT_SYNC_STAGES = [
  'trigger', 'cycle', 'resume', 'manual_retry', 'list', 'claim',
  'release', 'reconcile_success', 'reconcile_failure', 'retention',
  'persist', 'delivery',
] as const;
export type ClientSyncStage = (typeof CLIENT_SYNC_STAGES)[number];

export interface ClientLogContext {
  readonly method?: ClientHttpMethod;
  readonly route?: ClientLogRoute;
  readonly status?: number;
  readonly durationMs?: number;
  readonly code?: string;
  readonly failureCategory?: ClientFailureCategory;
  readonly commandType?: ClientCommandType;
  readonly aggregateType?: ClientAggregateType;
  readonly fromStatus?: ClientSyncStatus;
  readonly toStatus?: ClientSyncStatus;
  readonly attemptCount?: number;
  readonly stage?: ClientSyncStage;
  readonly cryptoAvailable?: boolean;
  readonly randomUuidAvailable?: boolean;
  readonly secureContext?: boolean;
  readonly insecureHttpTestMode?: boolean;
}

export interface ClientLogEvent {
  readonly timestamp: string;
  readonly level: AppLogLevel;
  readonly category: ClientLogCategory;
  readonly event: ClientLogEventName;
  readonly message?: string;
  readonly stack?: string;
  readonly correlationId?: string;
  readonly context?: Readonly<ClientLogContext>;
}

export type ClientLogValidationResult =
  | { readonly ok: true; readonly event: ClientLogEvent }
  | { readonly ok: false };

const ROOT_KEYS = new Set([
  'timestamp', 'level', 'category', 'event', 'message', 'stack', 'correlationId', 'context',
]);
const CONTEXT_KEYS = new Set([
  'method', 'route', 'status', 'durationMs', 'code', 'failureCategory',
  'commandType', 'aggregateType', 'fromStatus', 'toStatus', 'attemptCount', 'stage',
  'cryptoAvailable', 'randomUuidAvailable', 'secureContext', 'insecureHttpTestMode',
]);
const LEVELS: readonly AppLogLevel[] = ['debug', 'info', 'warn', 'error'];
const SAFE_CODE = /^[A-Z0-9_.-]{1,64}$/;

export function validateClientLogEvent(value: unknown): ClientLogValidationResult {
  const root = dataRecord(value, ROOT_KEYS);
  if (!root) return { ok: false };

  const timestamp = root['timestamp'];
  const level = root['level'];
  const category = root['category'];
  const event = root['event'];
  const message = root['message'];
  const stack = root['stack'];
  const correlationId = root['correlationId'];
  if (
    !isIsoTimestamp(timestamp)
    || !member(level, LEVELS)
    || !member(category, CLIENT_LOG_CATEGORIES)
    || !member(event, CLIENT_LOG_EVENTS)
    || !optionalString(message)
    || !optionalString(stack)
    || !(correlationId === undefined
      || (typeof correlationId === 'string' && SAFE_CLIENT_CORRELATION_ID.test(correlationId)))
  ) return { ok: false };

  const context = validateContext(root['context']);
  if (root['context'] !== undefined && !context) return { ok: false };
  return {
    ok: true,
    event: {
      timestamp,
      level,
      category,
      event,
      ...(message !== undefined
        ? { message: sanitizeLogText(message, CLIENT_LOG_MESSAGE_LIMIT) }
        : {}),
      ...(stack !== undefined
        ? { stack: sanitizeLogText(stack, CLIENT_LOG_STACK_LIMIT) }
        : {}),
      ...(typeof correlationId === 'string' ? { correlationId } : {}),
      ...(context ? { context } : {}),
    },
  };
}

export function normalizeClientApiRoute(
  rawUrl: string,
  currentOrigin?: string,
): ClientLogRoute | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl, currentOrigin ?? 'http://client.local');
  } catch {
    return undefined;
  }
  if (currentOrigin) {
    try {
      if (url.origin !== new URL(currentOrigin).origin) return undefined;
    } catch {
      return undefined;
    }
  }
  const path = url.pathname.length > 1 && url.pathname.endsWith('/')
    ? url.pathname.slice(0, -1)
    : url.pathname;
  if (!(path === '/api' || path.startsWith('/api/'))) return undefined;
  if (member(path, CLIENT_LOG_ROUTES)) return path;

  const dynamicRoutes: ReadonlyArray<readonly [RegExp, ClientLogRoute]> = [
    [/^\/api\/teams\/[^/]+$/, '/api/teams/:code'],
    [/^\/api\/production-orders\/[^/]+\/operations\/[^/]+$/,
      '/api/production-orders/:order/operations/:operation'],
    [/^\/api\/production-stops\/[^/]+\/finish$/, '/api/production-stops/:id/finish'],
    [/^\/api\/quality-control\/orders\/[^/]+$/, '/api/quality-control/orders/:orderNumber'],
  ];
  return dynamicRoutes.find(([pattern]) => pattern.test(path))?.[1] ?? '/api/:unmatched';
}

function validateContext(value: unknown): Readonly<ClientLogContext> | undefined {
  if (value === undefined) return undefined;
  const context = dataRecord(value, CONTEXT_KEYS);
  if (!context) return undefined;
  if (
    !optionalMember(context['method'], CLIENT_HTTP_METHODS)
    || !optionalMember(context['route'], CLIENT_LOG_ROUTES)
    || !optionalInteger(context['status'], 0, 599)
    || !optionalFinite(context['durationMs'], 0, 3_600_000)
    || !(context['code'] === undefined
      || (typeof context['code'] === 'string' && SAFE_CODE.test(context['code'])))
    || !optionalMember(context['failureCategory'], CLIENT_FAILURE_CATEGORIES)
    || !optionalMember(context['commandType'], CLIENT_COMMAND_TYPES)
    || !optionalMember(context['aggregateType'], CLIENT_AGGREGATE_TYPES)
    || !optionalMember(context['fromStatus'], CLIENT_SYNC_STATUSES)
    || !optionalMember(context['toStatus'], CLIENT_SYNC_STATUSES)
    || !optionalInteger(context['attemptCount'], 0, 1_000_000)
    || !optionalMember(context['stage'], CLIENT_SYNC_STAGES)
    || !optionalBoolean(context['cryptoAvailable'])
    || !optionalBoolean(context['randomUuidAvailable'])
    || !optionalBoolean(context['secureContext'])
    || !optionalBoolean(context['insecureHttpTestMode'])
  ) return undefined;
  return sanitizeLogMetadata(context) as ClientLogContext;
}

function dataRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function optionalInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined
    || (Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
}

function optionalFinite(value: unknown, min: number, max: number): boolean {
  return value === undefined
    || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}

function member<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function optionalMember<T extends string>(value: unknown, values: readonly T[]): boolean {
  return value === undefined || member(value, values);
}
