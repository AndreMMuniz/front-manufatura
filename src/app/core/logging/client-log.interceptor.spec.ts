import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientLogService } from './client-log.service';
import {
  CLIENT_CORRELATION_ID_GENERATOR,
  CLIENT_HTTP_CLOCK,
  CLIENT_HTTP_ORIGIN,
  clientLogInterceptor,
} from './client-log.interceptor';

describe('clientLogInterceptor', () => {
  let controller: HttpTestingController;
  let http: HttpClient;
  let capture: ReturnType<typeof vi.fn>;
  let clock: ReturnType<typeof vi.fn>;
  let generator: ReturnType<typeof vi.fn>;
  let now: number;

  function configure(platformId: 'browser' | 'server' = 'browser') {
    now = 10;
    capture = vi.fn();
    clock = vi.fn(() => now);
    generator = vi.fn(() => 'generated-correlation');
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([clientLogInterceptor])),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: ClientLogService, useValue: { capture } },
      { provide: CLIENT_HTTP_CLOCK, useValue: clock },
      { provide: CLIENT_CORRELATION_ID_GENERATOR, useValue: generator },
      { provide: CLIENT_HTTP_ORIGIN, useValue: 'https://app.test' },
    ] });
    controller = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  }

  afterEach(() => {
    controller?.verify();
    TestBed.resetTestingModule();
  });

  it('faz short-circuit SSR sem relógio, gerador, sink ou alteração do request', () => {
    configure('server');
    http.get('/api/orders?token=segredo').subscribe();
    const request = controller.expectOne('/api/orders?token=segredo');
    expect(request.request.headers.keys()).toEqual([]);
    request.flush({ ok: true });
    expect(clock).not.toHaveBeenCalled();
    expect(generator).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('exclui absolutamente o coletor antes de gerar correlação ou evento', () => {
    configure();
    http.post('/api/client-logs?x=1', {}).subscribe();
    controller.expectOne('/api/client-logs?x=1').flush(null, { status: 204, statusText: 'No Content' });
    expect(clock).not.toHaveBeenCalled();
    expect(generator).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('reutiliza correlação válida e emite uma falha terminal sem consumir o mesmo erro', () => {
    configure();
    let received: unknown;
    http.get('/api/quality-control/orders/372562?senha=segredo', {
      headers: { 'X-Correlation-Id': 'existing-correlation' },
    }).subscribe({ error: error => { received = error; } });
    const request = controller.expectOne('/api/quality-control/orders/372562?senha=segredo');
    expect(request.request.headers.get('x-correlation-id')).toBe('existing-correlation');
    now = 22.34;
    request.flush({ body: 'resultado sigiloso' }, { status: 503, statusText: 'Unavailable' });

    expect(received).toBeTruthy();
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith({
      level: 'error', category: 'http', event: 'http_request_failed',
      message: 'Falha em requisição HTTP interna.', correlationId: 'existing-correlation',
      context: {
        method: 'GET', route: '/api/quality-control/orders/:orderNumber',
        status: 503, durationMs: 12.34, code: 'HTTP_503', failureCategory: 'HTTP',
      },
    });
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/372562|senha|segredo|resultado/);
    expect(generator).not.toHaveBeenCalled();
  });

  it('prefere Idempotency-Key válida em comando e gera correlação nas demais chamadas', () => {
    configure();
    const key = '550e8400-e29b-41d4-a716-446655440000';
    http.post('/api/operations/start', {}, { headers: {
      'Idempotency-Key': key,
      'X-Correlation-Id': 'prior-correlation',
    } }).subscribe();
    const command = controller.expectOne('/api/operations/start');
    expect(command.request.headers.get('x-correlation-id')).toBe(key);
    command.flush({ ok: true });

    http.get('/api/work-centers').subscribe();
    const query = controller.expectOne('/api/work-centers');
    expect(query.request.headers.get('x-correlation-id')).toBe('generated-correlation');
    query.flush([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it('ignora origem externa e usa fallback fechado para rota interna desconhecida', () => {
    configure();
    http.get('https://externo.test/api/users/andre').subscribe();
    const external = controller.expectOne('https://externo.test/api/users/andre');
    expect(external.request.headers.has('x-correlation-id')).toBe(false);
    external.flush({ ok: true });

    http.get('https://app.test/api/users/andre?token=segredo').subscribe({ error: () => undefined });
    const internal = controller.expectOne('https://app.test/api/users/andre?token=segredo');
    internal.error(new ProgressEvent('network'));
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        route: '/api/:unmatched', status: 0, code: 'NETWORK', failureCategory: 'NETWORK',
      }),
    }));
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/andre|token|segredo/);
  });
});
