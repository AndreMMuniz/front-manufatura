import { describe, expect, it } from 'vitest';

import { normalizeCommandError } from '../models/sync-error';
import { publicCommandError } from './public-command-error';

describe('publicCommandError', () => {
  it('preserva o envelope público completo e seguro devolvido pelo gateway', () => {
    expect(publicCommandError(httpError({
      code: 'RULE_REJECTED',
      category: 'VALIDATION',
      deliveryOutcome: 'REJECTED',
      userMessage: 'Regra de negócio não atendida.',
      correlationId: 'corr-1',
    }))).toEqual({
      status: 422,
      code: 'RULE_REJECTED',
      category: 'VALIDATION',
      deliveryOutcome: 'REJECTED',
      userMessage: 'Regra de negócio não atendida.',
      correlationId: 'corr-1',
    });
  });

  it.each([
    [{ deliveryOutcome: 'SENT' }],
    [{ userMessage: 'payload: resultado=24.01' }],
    [{ userMessage: 42 }],
    [{ correlationId: 'corr\n-1' }],
  ])('descarta envelope com campo público inseguro: %o', (override) => {
    const error = httpError({
      code: 'RULE_REJECTED',
      category: 'VALIDATION',
      deliveryOutcome: 'REJECTED',
      userMessage: 'Regra de negócio não atendida.',
      correlationId: 'corr-1',
      ...override,
    });

    expect(publicCommandError(error)).toBe(error);
  });

  it('preserva o código público seguro do BFF de qualidade durante a normalização', () => {
    const error = publicCommandError(httpError({
      code: 'invalid-upstream-response',
      category: 'TRANSIENT',
      deliveryOutcome: 'UNCERTAIN',
      userMessage: 'O destino respondeu, mas a gravação ainda precisa ser confirmada.',
    }));

    expect(normalizeCommandError(error)).toMatchObject({
      code: 'invalid-upstream-response',
      deliveryOutcome: 'UNCERTAIN',
    });
  });
});

function httpError(body: Record<string, unknown>) {
  return { status: 422, error: body };
}
