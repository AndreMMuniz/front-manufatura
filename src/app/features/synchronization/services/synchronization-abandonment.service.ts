import { Inject, Injectable, InjectionToken, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AbandonCommandResult } from '../../../core/offline/models/command-abandonment';
import { LocalCommandRepository } from '../../../core/offline/repositories/local-command.repository';
import {
  SYNC_UNSYNCHRONIZED_ABANDON,
  SynchronizationPermissionPolicy,
  normalizeAbandonReason,
} from './synchronization-permission.policy';

export type AbandonmentResult =
  | AbandonCommandResult
  | 'invalid-reason'
  | 'secret-detected';

export type AbandonmentClock = () => Date;

export const ABANDONMENT_CLOCK = new InjectionToken<AbandonmentClock>('ABANDONMENT_CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

@Injectable({ providedIn: 'root' })
export class SynchronizationAbandonmentService implements OnDestroy {
  private sessionEpoch = 0;
  private readonly sessionSubscription: Subscription;

  constructor(
    private readonly repository: LocalCommandRepository,
    private readonly auth: AuthSessionService,
    private readonly policy: SynchronizationPermissionPolicy,
    @Inject(ABANDONMENT_CLOCK) private readonly clock: AbandonmentClock,
  ) {
    this.sessionSubscription = this.auth.session$.subscribe(() => {
      this.sessionEpoch += 1;
    });
  }

  async abandon(localId: string, reason: string): Promise<AbandonmentResult> {
    const user = this.auth.currentUser;
    if (!user || !this.policy.canAbandon(user)) return 'denied';
    const normalized = normalizeAbandonReason(reason);
    if ('reason' in normalized) {
      return normalized.reason === 'secret' ? 'secret-detected' : 'invalid-reason';
    }
    const ownerId = user.id.trim();
    const epoch = this.sessionEpoch;
    const now = this.clock();
    if (Number.isNaN(now.getTime())) return 'storage-error';
    return this.repository.abandonCommand({
      ownerId,
      actorId: ownerId,
      localId,
      permission: SYNC_UNSYNCHRONIZED_ABANDON,
      authorized: true,
      reason: normalized.value,
      now: now.toISOString(),
      sessionIsCurrent: () => (
        this.sessionEpoch === epoch
        && this.auth.currentUser?.id.trim() === ownerId
        && this.policy.canAbandon(this.auth.currentUser)
      ),
    });
  }

  ngOnDestroy(): void {
    this.sessionEpoch += 1;
    this.sessionSubscription.unsubscribe();
  }
}
