import { Inject, Injectable, InjectionToken, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import {
  CLIENT_AGGREGATE_TYPES,
  CLIENT_COMMAND_TYPES,
  SAFE_CLIENT_CORRELATION_ID,
  type ClientLogContext,
} from '../../../../logging/client-log-contracts';
import { AuthSessionService } from '../../auth/auth-session.service';
import { ClientLogService } from '../../logging/client-log.service';
import { OutboxEntry } from '../models/outbox-entry';
import { CommandResult } from '../models/sync-command';
import {
  NormalizedSyncError,
  SyncSchedulerConfig,
  assertValidSyncSchedulerConfig,
  calculateRetryDelay,
  normalizeCommandError,
} from '../models/sync-error';
import { JsonValue } from '../models/local-record';
import { OutboxRepository } from '../repositories/outbox.repository';
import { IdempotencyService } from './idempotency.service';
import {
  COMMAND_CONFIRMATION_ROUTER,
  CommandConfirmationRouter,
} from './command-confirmation-router';
import {
  SYNC_TIMEOUT_SCHEDULER,
  SYNC_TRANSPORT,
  SyncTransport,
  TimeoutScheduler,
  sendCommandWithTimeout,
  toSyncCommandRequest,
  validateCommandResult,
} from './sync-transport';
import {
  SYNC_SCHEDULER_CONFIGURATION,
  SyncTriggerService,
} from './sync-trigger.service';
import { SupervisorProofVault } from './supervisor-proof-vault';

export type SyncClock = () => Date;
export type SyncRandom = () => number;
export type ManualRetryResult =
  | 'queued'
  | 'no-credential'
  | 'stale-or-ineligible'
  | 'storage-error';

export type ConfirmationAttemptResult =
  | 'confirmed'
  | 'queued'
  | 'conflict'
  | 'pending'
  | 'unsupported';

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
  private remoteCredentialAvailable = false;
  private sessionEpoch = 0;
  private requested = false;
  private running?: Promise<void>;
  private sessionSubscription?: Subscription;
  private started = false;
  private readonly activeRequests = new Set<AbortController>();

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
    private readonly supervisorProofs: SupervisorProofVault = new SupervisorProofVault(),
    private readonly clientLogs: ClientLogService = {
      capture: () => undefined,
    } as unknown as ClientLogService,
    @Inject(COMMAND_CONFIRMATION_ROUTER)
    private readonly confirmations: CommandConfirmationRouter = new CommandConfirmationRouter([]),
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    assertValidSyncSchedulerConfig(this.config);
    this.started = true;
    this.sessionSubscription = this.auth.session$.subscribe((session) => {
      const owner = session?.user.id.trim() || null;
      this.abortActiveRequests();
      this.triggers.stop();
      this.activeOwner = owner;
      this.remoteCredentialAvailable = session?.mode === 'ONLINE' && Boolean(session.token);
      this.sessionEpoch += 1;
      if (owner && this.remoteCredentialAvailable) {
        this.triggers.start(() => {
          void this.requestSync().catch(() => undefined);
        });
        void this.resumeOwner(owner, this.sessionEpoch).catch(() => undefined);
      }
    });
  }

  requestSync(): Promise<void> {
    if (!this.started || !this.activeOwner || !this.remoteCredentialAvailable) {
      return Promise.resolve();
    }
    this.requested = true;
    if (!this.running) {
      this.running = this.drainRequests()
        .catch((error: unknown) => {
          this.captureFailure('sync_cycle_failed', 'cycle', 'SYNC_CYCLE_FAILURE');
          throw error;
        })
        .finally(() => {
          this.running = undefined;
        });
    }
    return this.running;
  }

  async retryError(localId: string): Promise<ManualRetryResult> {
    const owner = this.activeOwner;
    if (!owner || !this.remoteCredentialAvailable) {
      return 'no-credential';
    }
    const epoch = this.sessionEpoch;
    try {
      const changed = await this.outbox.retryError(owner, localId, this.nowIso());
      if (!this.isCurrent(owner, epoch)) {
        return 'stale-or-ineligible';
      }
      if (!changed) {
        return 'stale-or-ineligible';
      }
      void this.requestSync().catch(() => undefined);
      return 'queued';
    } catch {
      this.captureFailure('sync_storage_failed', 'manual_retry', 'STORAGE_FAILURE');
      return this.isCurrent(owner, epoch) ? 'storage-error' : 'stale-or-ineligible';
    }
  }

  async confirmDelivery(localId: string): Promise<ConfirmationAttemptResult> {
    const owner = this.activeOwner;
    if (!owner || !this.remoteCredentialAvailable) {
      return 'pending';
    }
    const epoch = this.sessionEpoch;
    let entry: OutboxEntry<JsonValue> | null;
    try {
      entry = await this.outbox.getById(owner, localId);
    } catch {
      this.captureFailure('sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE');
      return 'pending';
    }
    if (
      !entry ||
      entry.status !== 'CONFIRMATION_PENDING' ||
      !this.isCurrent(owner, epoch)
    ) {
      return 'pending';
    }

    const request = toSyncCommandRequest(entry);
    const controller = new AbortController();
    this.activeRequests.add(controller);
    try {
      const confirmation = await this.confirmations.confirm(request, controller.signal);
      if (!confirmation) {
        return 'unsupported';
      }
      if (!this.isCurrent(owner, epoch)) {
        return 'pending';
      }
      switch (confirmation.kind) {
        case 'MATCH': {
          let result: CommandResult;
          try {
            result = validateCommandResult(request, confirmation.result);
          } catch {
            return this.keepConfirmationPending(owner, localId, 'INVALID_CONFIRMATION_RECEIPT',
              'A consulta não confirmou a entrega.', epoch);
          }
          try {
            const changed = await this.outbox.confirmMatch({
              ownerId: owner,
              localId,
              now: this.nowIso(),
              result,
            });
            return changed ? 'confirmed' : 'pending';
          } catch {
            this.captureFailure('sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE', entry);
            return 'pending';
          }
        }
        case 'MISSING': {
          const now = this.clock();
          const delay = calculateRetryDelay(entry.attemptCount, this.random(), this.config);
          try {
            const changed = await this.outbox.confirmMissing({
              ownerId: owner,
              localId,
              now: validDate(now),
              nextAttemptAt: validDate(new Date(now.getTime() + delay)),
            });
            return changed ? 'queued' : 'pending';
          } catch {
            this.captureFailure('sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE', entry);
            return 'pending';
          }
        }
        case 'CONFLICT': {
          try {
            const changed = await this.outbox.confirmConflict({
              ownerId: owner,
              localId,
              now: this.nowIso(),
              code: confirmation.code,
              userMessage: confirmation.userMessage,
            });
            return changed ? 'conflict' : 'pending';
          } catch {
            this.captureFailure('sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE', entry);
            return 'pending';
          }
        }
        case 'INCONCLUSIVE':
          return this.keepConfirmationPending(
            owner,
            localId,
            confirmation.code,
            confirmation.userMessage,
            epoch,
          );
      }
    } catch {
      return this.keepConfirmationPending(
        owner,
        localId,
        'CONFIRMATION_LOOKUP_FAILED',
        'A consulta não foi conclusiva.',
        epoch,
      );
    } finally {
      this.activeRequests.delete(controller);
    }
  }

  stop(): void {
    this.started = false;
    this.activeOwner = null;
    this.remoteCredentialAvailable = false;
    this.sessionEpoch += 1;
    this.requested = false;
    this.sessionSubscription?.unsubscribe();
    this.sessionSubscription = undefined;
    this.abortActiveRequests();
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
      let candidates: readonly OutboxEntry<JsonValue>[];
      try {
        candidates = await this.outbox.listCandidates(
          owner,
          this.nowIso(),
          this.config.batchSize,
        );
      } catch (error) {
        this.captureFailure('sync_storage_failed', 'list', 'STORAGE_FAILURE');
        throw error;
      }
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
    let claimed: OutboxEntry<JsonValue> | undefined;
    try {
      claimed = await this.outbox.claim({
        ownerId: owner,
        localId: candidate.localId,
        leaseToken,
        now: validDate(now),
        leaseExpiresAt: validDate(new Date(now.getTime() + this.config.leaseDurationMs)),
      });
    } catch (error) {
      this.captureFailure('sync_storage_failed', 'claim', 'STORAGE_FAILURE', candidate);
      throw error;
    }
    if (!claimed) {
      return false;
    }
    if (!this.isCurrent(owner, epoch)) {
      try {
        await this.outbox.releaseClaim(owner, claimed.localId, leaseToken, this.nowIso());
      } catch (error) {
        this.captureFailure('sync_storage_failed', 'release', 'STORAGE_FAILURE', claimed);
        throw error;
      }
      return false;
    }

    this.captureTransition('sync_send_started', 'info', claimed, {
      fromStatus: candidate.status,
      toStatus: 'SYNCING',
    });
    const controller = new AbortController();
    this.activeRequests.add(controller);
    try {
      const result = await sendCommandWithTimeout(
        this.transport,
        toSyncCommandRequest(
          claimed,
          this.supervisorProofs.read(owner, claimed.localId) ?? undefined,
        ),
        this.config.requestTimeoutMs,
        this.timeoutScheduler,
        controller.signal,
      );
      try {
        await this.outbox.reconcileSuccess({
          ownerId: owner,
          localId: claimed.localId,
          leaseToken,
          now: this.nowIso(),
          result,
        });
      } catch (error) {
        this.captureFailure(
          'sync_storage_failed', 'reconcile_success', 'STORAGE_FAILURE', claimed,
        );
        throw error;
      }
      this.captureTransition('sync_succeeded', 'info', claimed, {
        fromStatus: 'SYNCING',
        toStatus: 'SYNCED',
      });
    } catch (error) {
      if (this.isCurrent(owner, epoch)) {
        await this.reconcileError(owner, claimed, leaseToken, normalizeCommandError(error));
      } else {
        let released: boolean;
        try {
          released = await this.outbox.releaseClaim(
            owner,
            claimed.localId,
            leaseToken,
            this.nowIso(),
          );
        } catch (releaseError) {
          this.captureFailure('sync_storage_failed', 'release', 'STORAGE_FAILURE', claimed);
          throw releaseError;
        }
        if (released && this.activeOwner === owner) {
          this.requested = true;
        }
      }
    } finally {
      this.activeRequests.delete(controller);
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
      deliveryOutcome: error.deliveryOutcome,
      ...(error.correlationId ? { correlationId: error.correlationId } : {}),
    };
    if (error.category === 'AUTH') {
      const authError = { ...persistedError, deliveryOutcome: 'NOT_DELIVERED' as const };
      try {
        await this.outbox.reconcileFailure({
          ownerId: owner,
          localId: claimed.localId,
          leaseToken,
          now: validDate(now),
          status: 'BLOCKED_AUTH',
          deliveryOutcome: 'NOT_DELIVERED',
          error: authError,
        });
      } catch (storageError) {
        this.captureFailure(
          'sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE', claimed,
        );
        throw storageError;
      }
      this.captureTransition('sync_blocked', 'warn', claimed, {
        fromStatus: 'SYNCING', toStatus: 'BLOCKED_AUTH',
        failureCategory: error.category, code: error.code,
      });
      return;
    }
    if (error.category === 'TRANSIENT' && error.deliveryOutcome === 'NOT_DELIVERED') {
      const delay = calculateRetryDelay(
        claimed.attemptCount,
        this.random(),
        this.config,
        error.retryAfterSeconds,
      );
      try {
        await this.outbox.reconcileFailure({
          ownerId: owner,
          localId: claimed.localId,
          leaseToken,
          now: validDate(now),
          status: 'RETRY_WAIT',
          deliveryOutcome: 'NOT_DELIVERED',
          nextAttemptAt: validDate(new Date(now.getTime() + delay)),
          error: persistedError,
        });
      } catch (storageError) {
        this.captureFailure(
          'sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE', claimed,
        );
        throw storageError;
      }
      this.captureTransition('sync_retry_scheduled', 'warn', claimed, {
        fromStatus: 'SYNCING', toStatus: 'RETRY_WAIT',
        failureCategory: error.category, code: error.code,
      });
      return;
    }
    if (error.deliveryOutcome === 'UNCERTAIN') {
      try {
        await this.outbox.reconcileFailure({
          ownerId: owner,
          localId: claimed.localId,
          leaseToken,
          now: validDate(now),
          status: 'CONFIRMATION_PENDING',
          deliveryOutcome: 'UNCERTAIN',
          error: persistedError,
        });
      } catch (storageError) {
        this.captureFailure(
          'sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE', claimed,
        );
        throw storageError;
      }
      this.captureTransition('sync_failed', 'warn', claimed, {
        fromStatus: 'SYNCING', toStatus: 'CONFIRMATION_PENDING',
        failureCategory: error.category, code: error.code,
      });
      return;
    }
    const targetStatus = 'ERROR';
    try {
      await this.outbox.reconcileFailure({
        ownerId: owner,
        localId: claimed.localId,
        leaseToken,
        now: validDate(now),
        status: targetStatus,
        deliveryOutcome: error.deliveryOutcome,
        error: persistedError,
      });
    } catch (storageError) {
      this.captureFailure(
        'sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE', claimed,
      );
      throw storageError;
    }
    this.captureTransition(
      'sync_failed',
      'error',
      claimed,
      {
        fromStatus: 'SYNCING', toStatus: targetStatus,
        failureCategory: error.category, code: error.code,
      },
    );
  }

  private async keepConfirmationPending(
    owner: string,
    localId: string,
    code: string,
    userMessage: string,
    epoch: number,
  ): Promise<ConfirmationAttemptResult> {
    if (!this.isCurrent(owner, epoch)) {
      return 'pending';
    }
    try {
      await this.outbox.keepConfirmationPending({
        ownerId: owner,
        localId,
        now: this.nowIso(),
        code,
        userMessage,
      });
      return 'pending';
    } catch {
      this.captureFailure('sync_storage_failed', 'reconcile_failure', 'STORAGE_FAILURE');
      return 'pending';
    }
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
    const results = await Promise.allSettled(workers);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejected) {
      throw rejected.reason;
    }
    return successfulClaims;
  }

  private isCurrent(owner: string, epoch: number): boolean {
    return this.started
      && this.remoteCredentialAvailable
      && this.activeOwner === owner
      && this.sessionEpoch === epoch;
  }

  private nowIso(): string {
    return validDate(this.clock());
  }

  private async resumeOwner(owner: string, epoch: number): Promise<void> {
    try {
      await this.outbox.resumeBlockedAuth(owner, this.nowIso());
    } catch (error) {
      this.captureFailure('sync_storage_failed', 'resume', 'STORAGE_FAILURE');
      throw error;
    }
    if (this.isCurrent(owner, epoch)) {
      await this.requestSync();
    }
  }

  private abortActiveRequests(): void {
    for (const controller of this.activeRequests) {
      controller.abort(new Error('A sessão mudou durante a sincronização.'));
    }
    this.activeRequests.clear();
  }

  private captureFailure(
    event: 'sync_cycle_failed' | 'sync_storage_failed',
    stage: ClientLogContext['stage'],
    code: string,
    entry?: OutboxEntry<JsonValue>,
  ): void {
    const commandType = entry && member(entry.commandType, CLIENT_COMMAND_TYPES)
      ? entry.commandType
      : undefined;
    const aggregateType = entry && member(entry.aggregateType, CLIENT_AGGREGATE_TYPES)
      ? entry.aggregateType
      : undefined;
    const correlationId = entry && SAFE_CLIENT_CORRELATION_ID.test(entry.idempotencyKey)
      ? entry.idempotencyKey
      : undefined;
    try {
      this.clientLogs.capture({
        level: 'error', category: 'synchronization', event,
        ...(correlationId ? { correlationId } : {}),
        context: {
          stage,
          code,
          ...(commandType ? { commandType } : {}),
          ...(aggregateType ? { aggregateType } : {}),
          ...(entry ? {
            attemptCount: Math.min(1_000_000, Math.max(0, Math.trunc(entry.attemptCount))),
          } : {}),
        },
      });
    } catch {
      // Synchronization behavior cannot depend on diagnostics.
    }
  }

  private captureTransition(
    event: 'sync_send_started' | 'sync_succeeded' | 'sync_retry_scheduled'
      | 'sync_blocked' | 'sync_failed',
    level: 'info' | 'warn' | 'error',
    entry: OutboxEntry<JsonValue>,
    transition: Pick<ClientLogContext,
      'fromStatus' | 'toStatus' | 'failureCategory' | 'code'>,
  ): void {
    const commandType = member(entry.commandType, CLIENT_COMMAND_TYPES)
      ? entry.commandType
      : undefined;
    const aggregateType = member(entry.aggregateType, CLIENT_AGGREGATE_TYPES)
      ? entry.aggregateType
      : undefined;
    const correlationId = SAFE_CLIENT_CORRELATION_ID.test(entry.idempotencyKey)
      ? entry.idempotencyKey
      : undefined;
    try {
      this.clientLogs.capture({
        level, category: 'synchronization', event,
        ...(correlationId ? { correlationId } : {}),
        context: {
          ...(commandType ? { commandType } : {}),
          ...(aggregateType ? { aggregateType } : {}),
          attemptCount: Math.min(1_000_000, Math.max(0, Math.trunc(entry.attemptCount))),
          ...transition,
        },
      });
    } catch {
      // Synchronization behavior cannot depend on diagnostics.
    }
  }
}

function validDate(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError('O relógio da sincronização retornou uma data inválida.');
  }
  return value.toISOString();
}

function member<T extends string>(value: string, values: readonly T[]): value is T {
  return (values as readonly string[]).includes(value);
}
