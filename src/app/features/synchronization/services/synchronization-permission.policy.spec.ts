import { describe, expect, it } from 'vitest';

import {
  SYNC_UNSYNCHRONIZED_ABANDON,
  SynchronizationPermissionPolicy,
  normalizeAbandonReason,
} from './synchronization-permission.policy';

describe('SynchronizationPermissionPolicy', () => {
  const policy = new SynchronizationPermissionPolicy();

  it('aplica default deny e exige o código canônico explícito', () => {
    expect(policy.canAbandon(null)).toBe(false);
    expect(policy.canAbandon(user([]))).toBe(false);
    expect(policy.canAbandon(user(['ADMIN', 'sync_unsynchronized_abandon']))).toBe(false);
    expect(policy.canAbandon(user([` ${SYNC_UNSYNCHRONIZED_ABANDON} `]))).toBe(true);
  });

  it('normaliza Unicode/controles, limita 10–500 e rejeita padrões de segredo', () => {
    expect(normalizeAbandonReason('  Ajuste\u0000 operacional válido  ')).toEqual({
      ok: true,
      value: 'Ajuste operacional válido',
    });
    expect(normalizeAbandonReason('curta')).toEqual({ ok: false, reason: 'length' });
    expect(normalizeAbandonReason('x'.repeat(501))).toEqual({ ok: false, reason: 'length' });
    expect(normalizeAbandonReason('Senha: supervisor123')).toEqual({
      ok: false,
      reason: 'secret',
    });
    expect(normalizeAbandonReason('Bearer eyJhbGciOiJIUzI1NiJ9')).toEqual({
      ok: false,
      reason: 'secret',
    });
  });
});

function user(permissoes: string[]) {
  return { id: 'owner-1', nome: 'Owner', login: 'owner', permissoes };
}
