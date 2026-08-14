import type { LogMetadata } from './log-contracts';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = '[MAX_DEPTH]';
const CIRCULAR = '[CIRCULAR]';
const DEFAULT_MESSAGE_LIMIT = 1_000;
const STACK_LIMIT = 4_000;
const MAX_KEYS = 50;
const MAX_ARRAY_ITEMS = 50;
const RESERVED_ROOT_KEYS = new Set(['level', 'message', 'timestamp', 'splat']);

const CREDENTIAL_KEY = /(?:authorization|cookie|password|passwd|senha|token|jwt|secret|segredo|credential|credencial|apikey|accesskey|privatekey|sessionid|supervisor(?:pin|password|senha|proof|prova))/i;
const SENSITIVE_BUSINESS_KEYS = new Set([
  'payload', 'body', 'requestbody', 'responsebody', 'response', 'proof', 'prova',
  'result', 'resultado', 'measurement', 'medicao', 'observation', 'observacao',
  'report', 'laudo', 'reason', 'motivo',
]);
const INLINE_SECRET = /\b(?:authorization|cookie|password|passwd|senha|token|jwt|secret|segredo|credential|credencial|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|supervisor[-_ ]?(?:pin|password|senha|proof|prova)|payload|body|request[-_ ]?body|response[-_ ]?body|response|proof|prova|result|resultado|measurement|medicao|observation|observacao|report|laudo|reason|motivo)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const BASIC = /\bBasic\s+[A-Za-z0-9+/]+=*/gi;
const JWT = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const URL_CREDENTIAL = /\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

export function sanitizeLogText(value: string, limit = DEFAULT_MESSAGE_LIMIT): string {
  const safeLimit = Number.isSafeInteger(limit) && limit >= 0 ? limit : DEFAULT_MESSAGE_LIMIT;
  return value
    .replace(BEARER, REDACTED)
    .replace(BASIC, REDACTED)
    .replace(JWT, REDACTED)
    .replace(URL_CREDENTIAL, '$1[REDACTED]@')
    .replace(INLINE_SECRET, REDACTED)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, safeLimit);
}

export function sanitizeLogMetadata(metadata: LogMetadata): Record<string, unknown> {
  const seen = new WeakSet<object>();
  seen.add(metadata);
  return sanitizeObject(metadata, 0, seen, true);
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') return sanitizeLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return '[UNSUPPORTED]';
  if (typeof value !== 'object') return '[UNSUPPORTED]';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (depth >= 4) return MAX_DEPTH;
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);
  try {
    if (value instanceof Error) {
      return sanitizeObject({
        name: errorDataProperty(value, 'name') ?? 'Error',
        message: sanitizeLogText(String(errorDataProperty(value, 'message') ?? '')),
        ...(errorDataProperty(value, 'code') !== undefined
          ? { code: errorDataProperty(value, 'code') }
          : {}),
        ...(errorDataProperty(value, 'status') !== undefined
          ? { status: errorDataProperty(value, 'status') }
          : {}),
        ...(errorDataProperty(value, 'stack') !== undefined
          ? { stack: sanitizeLogText(String(errorDataProperty(value, 'stack')), STACK_LIMIT) }
          : {}),
      }, depth + 1, seen);
    }

    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeValue(item, depth + 1, seen));
    }
    return sanitizeObject(value as Record<string, unknown>, depth, seen);
  } finally {
    seen.delete(value);
  }
}

function sanitizeObject(
  value: Readonly<Record<string, unknown>>,
  depth: number,
  seen: WeakSet<object>,
  root = false,
): Record<string, unknown> {
  if (depth >= 4) return { value: MAX_DEPTH };
  const keys = Object.keys(value)
    .filter(key => !root || !RESERVED_ROOT_KEYS.has(key))
    .slice(0, MAX_KEYS);
  return Object.fromEntries(keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const nested = descriptor && 'value' in descriptor ? descriptor.value : '[ACCESSOR]';
    return [
      sanitizeLogText(key, 100),
      isSensitiveKey(key) ? REDACTED : sanitizeValue(nested, depth + 1, seen),
    ];
  }));
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
  return CREDENTIAL_KEY.test(normalized) || SENSITIVE_BUSINESS_KEYS.has(normalized);
}

function errorDataProperty(error: Error, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
