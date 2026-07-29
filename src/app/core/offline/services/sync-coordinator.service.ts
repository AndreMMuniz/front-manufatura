import { Inject, Injectable, InjectionToken, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { AuthSessionService } from '../../auth/auth-session.service';
import { OutboxEntry } from '../models/outbox-entry';
import {
  NormalizedSyncError,
  SyncSchedulerConfig,
  calculateRetryDelay,
  normalizeCommandError,
} from '../models/sync-error';
import { JsonValue } from '../models/local-record';
import { OutboxRepository } from '../repositories/outbox.repository';
import { IdempotencyService } from './idempotency.service';
import {
  SYNC_TIMEOUT_SCHEDULER,
  SYNC_TRANSPORT,
  SyncTransport,
  TimeoutScheduler,
  sendCommandWithTimeout,
  toSyncCommandRequest,
} from './sync-transport';
import {
  SYNC_SCHEDULER_CONFIGURATION,
  SyncTriggerService,
} from './sync-trigger.service';

export type SyncClock = () => Date;
export type SyncRandom = () => number;

export const SYNC_CLOCK = new InjectionToken<SyncClock>('SYNC_CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

export const SYNC_RANDOM = new InjectionToken<SyncRandom>('SYNC_RANDOM', {
  providedIn: 'root',
  factory: () => () => Math.random(),
});

@Injectable({ providedIn: 'root' })
export class SyncCoordinatorService implements OnDestroy {
  private activeOwner: string | null = null;
  private sessionEpoch = 0;
  private requested = false;
  private running?: Promise<void>;
  private sessionSubscription?: Subscription;
  private started = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly auth: AuthSessionService,
    private readonly triggers: SyncTriggerService,
    @Inject(SYNC_TRANSPORT) private readonly transport: SyncTransport,
    private readonly idempotency: IdempotencyService,
    @Inject(SYNC_CLOCK) private readonly clock: SyncClock,
    @Inject(SYNC_RANDOM) private readonly random: SyncRandom,
    @Inject(SYNC_SCHEDULER_CONFIGURATION) private readonly config: SyncSchedulerConfig,
    @Inject(SYNC_TIMEOUT_SCHEDULER) private readonly timeoutScheduler: TimeoutScheduler,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.sessionSubscription = this.auth.session$.subscribe((session) => {
      const owner = session?.user.id.trim() || null;
      if (owner === this.activeOwner) {
        return;
      }
      this.activeOwner = owner;
      this.sessionEpoch += 1;
      if (owner) {
        const now = this.nowIso();
        void this.outbox.resumeBlockedAuth(owner, now).then(() => this.requestSync());
      }
    });
    this.triggers.start(() => {
      void this.requestSync();
    });
  }

  requestSync(): Promise<void> {
    if (!this.started || !this.activeOwner) {
      return Promise.resolve();
    }
    this.requested = true;
    if (!this.running) {
      this.running = this.drainRequests().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async retryError(localId: string): Promise<boolean> {
    const owner = this.activeOwner;
    if (!owner) {
      return false;
    }
    const changed = await this.outbox.retryError(owner, localId, this.nowIso());
    if (changed) {
      await this.requestSync();
    }
    return changed;
  }

  stop(): void {
    this.started = false;
    this.activeOwner = null;
    this.sessionEpoch += 1;
    this.requested = false;
    this.sessionSubscription?.unsubscribe();
    this.sessionSubscription = undefined;
    this.triggers.stop();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private async drainRequests(): Promise<void> {
    while (this.requested && this.activeOwner) {
      this.requested = false;
      const owner = this.activeOwner;
      const epoch = this.sessionEpoch;
      await this.processOwner(owner, epoch);
    }
  }

  private async processOwner(owner: string, epoch: number): Promise<void> {
    while (this.isCurrent(owner, epoch)) {
      const candidates = await this.outbox.listCandidates(
        owner,
        this.nowIso(),
        this.config.batchSize,
      );
      if (candidates.length === 0 || !this.isCurrent(owner, epoch)) {
        return;
      }
      const claimedCount = await this.runWithConcurrency(
        candidates,
        this.config.concurrency,
        (entry) => this.processEntry(owner, epoch, entry),
      );
      if (claimedCount === 0) {
        return;
      }
    }
  }

  private async processEntry(
    owner: string,
    epoch: number,
    candidate: OutboxEntry<JsonValue>,
  ): Promise<boolean> {
    if (!this.isCurrent(owner, epoch)) {
      return false;
    }
    const now = this.clock();
    const leaseToken = this.idempotency.resolve();
    const claimed = await this.outbox.claim({
      ownerId: owner,
      localId: candidate.localId,
      leaseToken,
      now: validDate(now),
      leaseExpiresAt: validDate(new Date(now.getTime() + this.config.leaseDurationMs)),
    });
    if (!claimed) {
      return false;
    }

    try {
      const result = await sendCommandWithTimeout(
        this.transport,
        toSyncCommandRequest(claimed),
        this.config.requestTimeoutMs,
        this.timeoutScheduler,
      );
      if (this.isCurrent(owner, epoch)) {
        await this.outbox.reconcileSuccess({
          ownerId: owner,
          localId: claimed.localId,
          leaseToken,
          now: this.nowIso(),
          result,
        });
      }
    } catch (error) {
      if (this.isCurrent(owner, epoch)) {
        await this.reconcileError(owner, claimed, leaseToken, normalizeCommandError(error));
      }
    }
    return true;
  }

  private async reconcileError(
    owner: string,
    claimed: OutboxEntry<JsonValue>,
    leaseToken: string,
    error: NormalizedSyncError,
  ): Promise<void> {
    const now = this.clock();
    const persistedError = {
      code: error.code,
      category: error.category,
      userMessage: error.userMessage,
      ...(error.correlationId ? { correlationId: error.correlationId } : {}),
    };
    if (error.category === 'TRANSIENT') {
      const delay = calculateRetryDelay(
        claimed.attemptCount,
        this.random(),
        this.config,
        error.retryAfterSeconds,
      );
      await this.outbox.reconcileFailure({
        ownerId: owner,
        localId: claimed.localId,
        leaseToken,
        now: validDate(now),
        status: 'RETRY_WAIT',
        nextAttemptAt: validDate(new Date(now.getTime() + delay)),
        error: persistedError,
      });
      return;
    }
    await this.outbox.reconcileFailure({
      ownerId: owner,
      localId: claimed.localId,
      leaseToken,
      now: validDate(now),
      status: error.category === 'AUTH' ? 'BLOCKED_AUTH' : 'ERROR',
      error: persistedError,
    });
  }

  private async runWithConcurrency<T>(
    values: readonly T[],
    concurrency: number,
    task: (value: T) => Promise<boolean>,
  ): Promise<number> {
    let cursor = 0;
    let successfulClaims = 0;
    const workerCount = Math.max(1, Math.min(values.length, Math.trunc(concurrency) || 1));
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        if (await task(values[index])) {
          successfulClaims += 1;
        }
      }
    });
    await Promise.all(workers);
    return successfulClaims;
  }

  private isCurrent(owner: string, epoch: number): boolean {
    return this.started && this.activeOwner === owner && this.sessionEpoch === epoch;
  }

  private nowIso(): string {
    return validDate(this.clock());
  }
}

function validDate(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError('O relógio da sincronização retornou uma data inválida.');
  }
  return value.toISOString();
}
