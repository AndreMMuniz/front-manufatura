import { describe, expect, it } from 'vitest';

import {
  CLIENT_LOG_MESSAGE_LIMIT,
  CLIENT_LOG_STACK_LIMIT,
  normalizeClientApiRoute,
  validateClientLogEvent,
} from './client-log-contracts';

describe('client log contracts', () => {
  const valid = () => ({
    timestamp: '2026-08-14T20:00:00.000Z',
    level: 'error',
    category: 'http',
    event: 'http_request_failed',
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    message: `Bearer segredo ${'m'.repeat(1_200)}`,
    stack: `Bearer segredo; ${'s'.repeat(4_500)}`,
    context: {
      method: 'POST', route: '/api/operations/start', status: 503,
      durationMs: 12.34, code: 'HTTP_503', failureCategory: 'TRANSIENT',
      commandType: 'START_OPERATION', aggregateType: 'OPERATION',
      fromStatus: 'PENDING', toStatus: 'RETRY_WAIT', attemptCount: 2,
      cryptoAvailable: true, secureContext: false, insecureHttpTestMode: false,
    },
  });

  it('valida schema fechado e sanitiza texto/contexto nos limites compartilhados', () => {
    const result = validateClientLogEvent(valid());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.message).toHaveLength(CLIENT_LOG_MESSAGE_LIMIT);
    expect(result.event.stack).toHaveLength(CLIENT_LOG_STACK_LIMIT);
    expect(result.event.message).not.toContain('segredo');
    expect(result.event.stack).not.toContain('segredo');
    expect(result.event.context).toEqual(valid().context);
  });

  const deliveryEvent = (event: string, context: Record<string, unknown>) => ({
    timestamp: '2026-08-14T20:00:00.000Z',
    level: event === 'sync_delivery_rejected' ? 'error' : 'warn',
    category: 'synchronization',
    event,
    correlationId: 'corr-delivery-1',
    context: {
      commandType: 'START_OPERATION', aggregateType: 'OPERATION', attemptCount: 2,
      ...context,
    },
  });

  it.each([
    ['confirmada', 'sync_delivery_confirmed', 'info', {
      fromStatus: 'SYNCING', toStatus: 'SYNCED', deliveryOutcome: 'CONFIRMED',
    }],
    ['rejeitada', 'sync_delivery_rejected', 'error', {
      fromStatus: 'SYNCING', toStatus: 'ERROR', deliveryOutcome: 'REJECTED',
      failureCategory: 'VALIDATION', code: 'COMMAND_REJECTED',
    }],
    ['incerta', 'sync_delivery_uncertain', 'warn', {
      fromStatus: 'SYNCING', toStatus: 'CONFIRMATION_PENDING', deliveryOutcome: 'UNCERTAIN',
      failureCategory: 'TRANSIENT', code: 'INVALID_UPSTREAM_RESPONSE',
    }],
    ['consulta MATCH', 'sync_confirmation_checked', 'info', {
      fromStatus: 'CONFIRMATION_PENDING', toStatus: 'SYNCED',
      deliveryOutcome: 'CONFIRMED', confirmationResult: 'MATCH',
    }],
    ['consulta MISSING', 'sync_confirmation_checked', 'info', {
      fromStatus: 'CONFIRMATION_PENDING', toStatus: 'PENDING',
      deliveryOutcome: 'NOT_DELIVERED', confirmationResult: 'MISSING',
    }],
    ['consulta CONFLICT', 'sync_confirmation_checked', 'info', {
      fromStatus: 'CONFIRMATION_PENDING', toStatus: 'ERROR',
      deliveryOutcome: 'UNCERTAIN', confirmationResult: 'CONFLICT',
      failureCategory: 'CONFLICT', code: 'REMOTE_CONTENT_CONFLICT',
    }],
    ['consulta INCONCLUSIVE', 'sync_confirmation_checked', 'info', {
      fromStatus: 'CONFIRMATION_PENDING', toStatus: 'CONFIRMATION_PENDING',
      deliveryOutcome: 'UNCERTAIN', confirmationResult: 'INCONCLUSIVE',
      failureCategory: 'TRANSIENT', code: 'REMOTE_LOOKUP_UNAVAILABLE',
    }],
  ] as const)('aceita a transição de entrega %s', (_name, event, level, context) => {
    expect(validateClientLogEvent({ ...deliveryEvent(event, context), level }).ok).toBe(true);
  });

  it.each([
    ['mensagem livre', { message: 'laudo=segredo' }],
    ['stack livre', { stack: 'stack segredo' }],
    ['confirmada com outcome incerto', { deliveryOutcome: 'UNCERTAIN' }],
    ['confirmada com código de falha', { code: 'UNEXPECTED' }],
  ])('rejeita evento de entrega confirmado com %s', (_name, override) => {
    expect(validateClientLogEvent({
      ...deliveryEvent('sync_delivery_confirmed', {
        level: 'info', fromStatus: 'SYNCING', toStatus: 'SYNCED', deliveryOutcome: 'CONFIRMED',
      }),
      ...override,
    }).ok).toBe(false);
  });

  it.each([
    ['rejeitada incerta', 'sync_delivery_rejected', {
      fromStatus: 'SYNCING', toStatus: 'ERROR', deliveryOutcome: 'UNCERTAIN',
      failureCategory: 'VALIDATION', code: 'COMMAND_REJECTED',
    }],
    ['incerta confirmada', 'sync_delivery_uncertain', {
      fromStatus: 'SYNCING', toStatus: 'CONFIRMATION_PENDING', deliveryOutcome: 'CONFIRMED',
      failureCategory: 'TRANSIENT', code: 'INVALID_UPSTREAM_RESPONSE',
    }],
    ['incerta sem categoria', 'sync_delivery_uncertain', {
      fromStatus: 'SYNCING', toStatus: 'CONFIRMATION_PENDING', deliveryOutcome: 'UNCERTAIN',
      code: 'INVALID_UPSTREAM_RESPONSE',
    }],
    ['consulta com matriz inválida', 'sync_confirmation_checked', {
      fromStatus: 'CONFIRMATION_PENDING', toStatus: 'SYNCED',
      deliveryOutcome: 'UNCERTAIN', confirmationResult: 'MATCH',
    }],
  ] as const)('rejeita combinação impossível de %s', (_name, event, context) => {
    expect(validateClientLogEvent(deliveryEvent(event, context)).ok).toBe(false);
  });

  it.each([
    ['chave raiz extra', { ...valid(), body: { password: 'segredo' } }],
    ['categoria aberta', { ...valid(), category: 'security' }],
    ['evento aberto', { ...valid(), event: 'arbitrary_event' }],
    ['timestamp inválido', { ...valid(), timestamp: 'agora' }],
    ['correlação inválida', { ...valid(), correlationId: 'com espaço' }],
    ['contexto extra', { ...valid(), context: { ...valid().context, payload: 'segredo' } }],
    ['método inválido', { ...valid(), context: { ...valid().context, method: 'CONNECT' } }],
    ['rota fora do catálogo', { ...valid(), context: { ...valid().context, route: '/api/users/andre' } }],
    ['status decimal', { ...valid(), context: { ...valid().context, status: 200.5 } }],
    ['duração infinita', { ...valid(), context: { ...valid().context, durationMs: Infinity } }],
    ['código inseguro', { ...valid(), context: { ...valid().context, code: 'Bearer segredo' } }],
    ['outcome desconhecido', { ...valid(), context: { ...valid().context, deliveryOutcome: 'SENT' } }],
    ['payload operacional', { ...valid(), context: { ...valid().context, payload: { quantity: 5 } } }],
    ['resultado operacional', { ...valid(), context: { ...valid().context, result: { withinRange: false } } }],
    ['laudo operacional', { ...valid(), context: { ...valid().context, laudo: 'segredo' } }],
    ['observação operacional', { ...valid(), context: { ...valid().context, observacao: 'segredo' } }],
    ['credencial operacional', { ...valid(), context: { ...valid().context, token: 'segredo' } }],
    ['url operacional', { ...valid(), context: { ...valid().context, url: 'https://user:secret@example.test' } }],
    ['body operacional', { ...valid(), context: { ...valid().context, body: 'senha=segredo' } }],
    ['stack operacional', { ...valid(), context: { ...valid().context, stack: 'stack segredo' } }],
    ['tentativa negativa', { ...valid(), context: { ...valid().context, attemptCount: -1 } }],
    ['flag não booleana', { ...valid(), context: { ...valid().context, secureContext: 'sim' } }],
  ])('rejeita %s antes da sanitização', (_name, event) => {
    expect(validateClientLogEvent(event)).toEqual({ ok: false });
  });

  it('não lança para null, arrays, ciclos ou getters', () => {
    const cyclic: Record<string, unknown> = valid();
    cyclic['context'] = cyclic;
    const getter = Object.defineProperty(valid(), 'message', {
      enumerable: true,
      get: () => { throw new Error('não avaliar'); },
    });

    expect(validateClientLogEvent(null)).toEqual({ ok: false });
    expect(validateClientLogEvent([])).toEqual({ ok: false });
    expect(validateClientLogEvent(cyclic)).toEqual({ ok: false });
    expect(() => validateClientLogEvent(getter)).not.toThrow();
    expect(validateClientLogEvent(getter)).toEqual({ ok: false });
  });

  it('normaliza apenas rotas conhecidas e elimina query, hash e identificadores', () => {
    expect(normalizeClientApiRoute('/api/quality-control/orders/372562?senha=x#frag'))
      .toBe('/api/quality-control/orders/:orderNumber');
    expect(normalizeClientApiRoute('https://app.test/api/teams/MONT%2003?x=1', 'https://app.test'))
      .toBe('/api/teams/:code');
    expect(normalizeClientApiRoute('/api/production-stops/stop%2F01/finish'))
      .toBe('/api/production-stops/:id/finish');
    expect(normalizeClientApiRoute('/api/users/andre')).toBe('/api/:unmatched');
    expect(normalizeClientApiRoute('https://externo.test/api/teams/andre', 'https://app.test'))
      .toBeUndefined();
    expect(normalizeClientApiRoute('/public')).toBeUndefined();
  });
});
