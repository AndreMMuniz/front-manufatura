import { Inject, Injectable, InjectionToken } from '@angular/core';

import { User } from '../../../core/auth/auth.models';
import { SYNC_UNSYNCHRONIZED_ABANDON } from '../../../core/offline/models/command-abandonment';

export { SYNC_UNSYNCHRONIZED_ABANDON };

export type NormalizedAbandonReason =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: 'length' | 'secret' };

export const TEMPORARY_SYNC_CANCELLATION_RELEASE = new InjectionToken<boolean>(
  'TEMPORARY_SYNC_CANCELLATION_RELEASE',
  {
    providedIn: 'root',
    // Remover a liberação temporária quando a administração de usuários
    // passar a conceder SYNC_UNSYNCHRONIZED_ABANDON.
    factory: () => true,
  },
);

@Injectable({ providedIn: 'root' })
export class SynchronizationPermissionPolicy {
  constructor(
    @Inject(TEMPORARY_SYNC_CANCELLATION_RELEASE)
    private readonly temporaryRelease: boolean = true,
  ) {}

  canAbandon(user: User | null): boolean {
    if (!user) return false;
    return this.temporaryRelease || user.permissoes.some(
      permission => permission.trim() === SYNC_UNSYNCHRONIZED_ABANDON,
    );
  }
}

export function normalizeAbandonReason(value: string): NormalizedAbandonReason {
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length < 10 || normalized.length > 500) {
    return { ok: false, reason: 'length' };
  }
  if (
    /\b(?:senha|password|passphrase|token|bearer|api[_ -]?key|secret|credencial)\b\s*[:=]?\s*\S+/iu
      .test(normalized)
  ) {
    return { ok: false, reason: 'secret' };
  }
  return { ok: true, value: normalized };
}
