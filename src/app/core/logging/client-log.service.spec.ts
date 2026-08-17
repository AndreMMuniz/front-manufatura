import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_LOG_CLOCK, ClientLogService } from './client-log.service';

describe('ClientLogService', () => {
  let http: HttpTestingController;
  let now: number;
  let intercepted: (url: string) => void;
  let clock: ReturnType<typeof vi.fn>;

  function configure(platformId: 'browser' | 'server' = 'browser') {
    now = 1_000;
    clock = vi.fn(() => now);
    intercepted = vi.fn();
    const interceptor: HttpInterceptorFn = (request, next) => {
      intercepted(request.url);
      return next(request);
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([interceptor])),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: CLIENT_LOG_CLOCK, useValue: clock },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(ClientLogService);
  }

  afterEach(() => {
    http?.verify();
    TestBed.resetTestingModule();
  });

  it('envia imediatamente via HttpBackend, sem interceptores, credenciais ou persistência', () => {
    const service = configure();
    service.capture({
      level: 'error', category: 'http', event: 'http_request_failed',
      message: 'Bearer segredo; falha', correlationId: 'corr-1',
      context: { method: 'POST', route: '/api/operations/start', status: 503 },
    });

    const request = http.expectOne('/api/client-logs');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-correlation-id')).toBe('corr-1');
    expect(request.request.headers.has('authorization')).toBe(false);
    expect(request.request.withCredentials).toBe(false);
    expect(request.request.credentials).toBe('omit');
    expect(request.request.body).toEqual(expect.objectContaining({
      timestamp: new Date(now).toISOString(), message: '[REDACTED]; falha',
    }));
    expect(intercepted).not.toHaveBeenCalled();
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('omite correlação inválida e absorve erro/rejeição do endpoint', () => {
    const service = configure();
    expect(() => service.capture({
      level: 'warn', category: 'capability', event: 'identity_capability_unavailable',
      correlationId: 'inválida com espaço', context: { randomUuidAvailable: false },
    } as never)).not.toThrow();
    http.expectNone('/api/client-logs');

    service.capture({
      level: 'warn', category: 'capability', event: 'identity_capability_unavailable',
      context: { randomUuidAvailable: false },
    });
    const request = http.expectOne('/api/client-logs');
    expect(request.request.headers.has('x-correlation-id')).toBe(false);
    expect(() => request.error(new ProgressEvent('network'))).not.toThrow();
  });

  it('é noop no SSR sem consultar relógio nem enviar request', () => {
    const service = configure('server');
    expect(() => service.capture({
      level: 'error', category: 'browser', event: 'angular_error', message: 'falha',
    })).not.toThrow();
    expect(clock).not.toHaveBeenCalled();
    http.expectNone('/api/client-logs');
  });

  it('deduplica somente angular_error por um segundo', () => {
    const service = configure();
    const angular = {
      level: 'error', category: 'browser', event: 'angular_error',
      message: 'falha', stack: 'stack',
    } as const;
    service.capture(angular);
    service.capture(angular);
    http.expectOne('/api/client-logs').flush(null, { status: 204, statusText: 'No Content' });

    const sync = {
      level: 'warn', category: 'synchronization', event: 'sync_failed',
      context: { code: 'TIMEOUT' as const, failureCategory: 'TRANSIENT' as const },
    } as const;
    service.capture(sync);
    service.capture(sync);
    http.match('/api/client-logs').forEach(request =>
      request.flush(null, { status: 204, statusText: 'No Content' }));

    now += 1_000;
    service.capture(angular);
    http.expectOne('/api/client-logs').flush(null, { status: 204, statusText: 'No Content' });
  });

  it('limita o cache de assinaturas globais a 100 entradas', () => {
    const service = configure();
    for (let index = 0; index < 101; index += 1) {
      service.capture({
        level: 'error', category: 'browser', event: 'angular_error', message: `falha-${index}`,
      });
    }
    http.match('/api/client-logs').forEach(request =>
      request.flush(null, { status: 204, statusText: 'No Content' }));

    service.capture({
      level: 'error', category: 'browser', event: 'angular_error', message: 'falha-0',
    });
    http.expectOne('/api/client-logs').flush(null, { status: 204, statusText: 'No Content' });
  });
});
