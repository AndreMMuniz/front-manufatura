import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { tap } from 'rxjs';

import {
  CLIENT_HTTP_METHODS,
  SAFE_CLIENT_CORRELATION_ID,
  type ClientHttpMethod,
  normalizeClientApiRoute,
} from '../../../logging/client-log-contracts';
import { ClientLogService } from './client-log.service';

export type ClientHttpClock = () => number;
export type ClientCorrelationIdGenerator = () => string | undefined;

export const CLIENT_HTTP_CLOCK = new InjectionToken<ClientHttpClock>('CLIENT_HTTP_CLOCK', {
  providedIn: 'root',
  factory: () => Date.now,
});

export const CLIENT_HTTP_ORIGIN = new InjectionToken<string | undefined>('CLIENT_HTTP_ORIGIN', {
  providedIn: 'root',
  factory: () => typeof globalThis.location === 'undefined' ? undefined : globalThis.location.origin,
});

export const CLIENT_CORRELATION_ID_GENERATOR =
  new InjectionToken<ClientCorrelationIdGenerator>('CLIENT_CORRELATION_ID_GENERATOR', {
    providedIn: 'root',
    factory: () => () => {
      try {
        return typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : undefined;
      } catch {
        return undefined;
      }
    },
  });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const clientLogInterceptor: HttpInterceptorFn = (request, next) => {
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) return next(request);
  if (isClientLogRequest(request.urlWithParams)) return next(request);

  const route = normalizeClientApiRoute(request.urlWithParams, inject(CLIENT_HTTP_ORIGIN));
  if (!route) return next(request);

  const clock = inject(CLIENT_HTTP_CLOCK);
  const generator = inject(CLIENT_CORRELATION_ID_GENERATOR);
  const sink = inject(ClientLogService);
  const startedAt = safeClock(clock);
  const correlationId = requestCorrelationId(request.method, request.headers, generator);
  const correlatedRequest = correlationId
    ? request.clone({ setHeaders: { 'X-Correlation-Id': correlationId } })
    : request;

  return next(correlatedRequest).pipe(tap({
    error: (error: unknown) => {
      const status = error instanceof HttpErrorResponse
        && Number.isInteger(error.status) && error.status >= 0 && error.status <= 599
        ? error.status
        : 0;
      const durationMs = Math.min(
        3_600_000,
        Math.max(0, Math.round((safeClock(clock) - startedAt) * 100) / 100),
      );
      const method = safeMethod(request.method);
      try {
        sink.capture({
          level: 'error',
          category: 'http',
          event: 'http_request_failed',
          message: 'Falha em requisição HTTP interna.',
          ...(correlationId ? { correlationId } : {}),
          context: {
            ...(method ? { method } : {}),
            route,
            status,
            durationMs,
            code: status > 0 ? `HTTP_${status}` : 'NETWORK',
            failureCategory: status > 0 ? 'HTTP' : 'NETWORK',
          },
        });
      } catch {
        // Observability must not replace the original HTTP error.
      }
    },
  }));
};

function isClientLogRequest(url: string): boolean {
  return /^(?:https?:\/\/[^/?#]+)?\/api\/client-logs(?:[?#]|$)/i.test(url);
}

function requestCorrelationId(
  method: string,
  headers: { get(name: string): string | null },
  generate: ClientCorrelationIdGenerator,
): string | undefined {
  const idempotencyKey = headers.get('Idempotency-Key');
  if (COMMAND_METHODS.has(method.toUpperCase()) && idempotencyKey && UUID_V4.test(idempotencyKey)) {
    return idempotencyKey.toLowerCase();
  }
  const existing = headers.get('X-Correlation-Id');
  if (existing && SAFE_CLIENT_CORRELATION_ID.test(existing)) return existing;
  try {
    const generated = generate();
    return generated && SAFE_CLIENT_CORRELATION_ID.test(generated) ? generated : undefined;
  } catch {
    return undefined;
  }
}

function safeClock(clock: ClientHttpClock): number {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function safeMethod(value: string): ClientHttpMethod | undefined {
  const method = value.toUpperCase();
  return (CLIENT_HTTP_METHODS as readonly string[]).includes(method)
    ? method as ClientHttpMethod
    : undefined;
}
