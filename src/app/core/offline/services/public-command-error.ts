import type { ApiCommandErrorCategory } from '../models/sync-error';

type PublicDeliveryOutcome = 'NOT_DELIVERED' | 'REJECTED' | 'UNCERTAIN';

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UNSAFE_PUBLIC_MESSAGE = /\b(?:password|passwd|senha|token|cookie|authorization|credential|credencial|jwt|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|supervisor[-_ ]?(?:pin|password|senha)|payload|laudo|\bbody\b|\bstack\b)\b|https?:\/\/|\b(?:resultado(?:\s+medido)?|nr\s*ficha|cod\s*exame|cod\s*componente)\s*(?:["'])?\s*[:=]/i;

/**
 * Narrows an Angular HTTP error to the public, safe BFF envelope.
 *
 * A partial or malformed envelope must remain untouched so the common error
 * normalization path classifies the attempted request conservatively.
 */
export function publicCommandError(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error;
  const response = error as Readonly<Record<string, unknown>>;
  const body = response['error'];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error;

  const publicBody = body as Readonly<Record<string, unknown>>;
  const status = response['status'];
  const code = publicBody['code'];
  const category = publicBody['category'];
  const deliveryOutcome = publicBody['deliveryOutcome'];
  const userMessage = publicBody['userMessage'];
  const correlationId = publicBody['correlationId'];

  if (
    !isHttpStatus(status)
    || !isSafeCode(code)
    || !isApiCategory(category)
    || !isPublicDeliveryOutcome(deliveryOutcome)
    || !isSafeUserMessage(userMessage)
    || (correlationId !== undefined && !isSafeCorrelationId(correlationId))
  ) return error;

  return {
    status,
    code,
    category,
    deliveryOutcome,
    userMessage,
    ...(correlationId ? { correlationId } : {}),
  };
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599;
}

function isSafeCode(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CODE.test(value);
}

function isApiCategory(value: unknown): value is ApiCommandErrorCategory {
  return value === 'TRANSIENT' || value === 'AUTH' || value === 'VALIDATION' || value === 'CONFLICT';
}

function isPublicDeliveryOutcome(value: unknown): value is PublicDeliveryOutcome {
  return value === 'NOT_DELIVERED' || value === 'REJECTED' || value === 'UNCERTAIN';
}

function isSafeUserMessage(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 240
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !UNSAFE_PUBLIC_MESSAGE.test(value);
}

function isSafeCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CORRELATION_ID.test(value);
}
