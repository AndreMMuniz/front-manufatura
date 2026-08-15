import { Inject, Injectable, InjectionToken, isDevMode } from '@angular/core';

import { User } from '../../../core/auth/auth.models';
import { SYNC_UNSYNCHRONIZED_ABANDON } from '../../../core/offline/models/command-abandonment';

export { SYNC_UNSYNCHRONIZED_ABANDON };

export type NormalizedAbandonReason =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: 'length' | 'secret' };

export const DEVELOPMENT_SYNC_CANCELLATION = new InjectionToken<boolean>(
  'DEVELOPMENT_SYNC_CANCELLATION',
  { providedIn: 'root', factory: () => isDevMode() },
);

@Injectable({ providedIn: 'root' })
export class SynchronizationPermissionPolicy {
  constructor(
    @Inject(DEVELOPMENT_SYNC_CANCELLATION)
    private readonly developmentOverride: boolean = isDevMode(),
  ) {}

  canAbandon(user: User | null): boolean {
    if (!user) return false;
    return this.developmentOverride || user.permissoes.some(
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
