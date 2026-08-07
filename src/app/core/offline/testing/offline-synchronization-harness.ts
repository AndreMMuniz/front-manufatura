import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { OUTBOX_STORE } from '../database/database-schema';
import { OfflineDatabase } from '../database/offline-database';
import { JsonValue } from '../models/local-record';
import { OutboxEntry } from '../models/outbox-entry';
import { CommandResult } from '../models/sync-command';
import { OutboxRepository } from '../repositories/outbox.repository';
import { transactionComplete } from '../repositories/repository-utils';
import { toSyncCommandRequest, validateCommandResult } from '../services/sync-transport';

const OWNER = 'playwright-sync-owner';
const LEASE_MS = 200;

@Component({
  selector: 'app-offline-synchronization-harness',
  template: `
    <button type="button" data-testid="seed-single" (click)="seed('single')">Seed single</button>
    <button type="button" data-testid="seed-recovery" (click)="seed('recovery')">
      Seed recovery
    </button>
    <button type="button" data-testid="seed-lost" (click)="seed('lost')">Seed lost</button>
    <button type="button" data-testid="claim-recovery" (click)="claimRecovery()">
      Claim recovery
    </button>
    <button type="button" data-testid="sync" (click)="sync()">Sync</button>
    <pre data-testid="sync-result">{{ result() }}</pre>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflineSynchronizationHarness {
  private readonly database = inject(OfflineDatabase);
  private readonly outbox = inject(OutboxRepository);
  private readonly tabId = globalThis.crypto.randomUUID();

  readonly result = signal('');

  async seed(kind: 'single' | 'recovery' | 'lost'): Promise<void> {
    const now = new Date().toISOString();
    const value: OutboxEntry<JsonValue> = {
      localId: `sync-${kind}`,
      idempotencyKey: `sync-${kind}-key`,
      payloadSchemaVersion: 1,
      aggregateType: 'PLAYWRIGHT_SYNC',
      aggregateId: kind,
      commandType: 'CONFIRM_SYNC_PROBE',
      payload: { kind, quantity: 5 },
      canonicalPayload: JSON.stringify({ kind, quantity: 5 }),
      payloadHash: `hash-${kind}`,
      ownerId: OWNER,
      status: 'PENDING',
      dependencyIds: [],
      attemptCount: 0,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(OUTBOX_STORE).put(value);
    await completed;
    this.result.set(JSON.stringify({ seeded: kind }));
  }

  async claimRecovery(): Promise<void> {
    const now = new Date();
    const claimed = await this.outbox.claim({
      ownerId: OWNER,
      localId: 'sync-recovery',
      leaseToken: `${this.tabId}-held`,
      now: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
    });
    this.result.set(JSON.stringify({ held: Boolean(claimed), tabId: this.tabId }));
  }

  async sync(): Promise<void> {
    const now = new Date();
    const candidates = await this.outbox.listCandidates(OWNER, now.toISOString(), 10);
    const outcomes: Array<{ readonly localId: string; readonly status: string }> = [];
    for (const candidate of candidates) {
      const leaseToken = `${this.tabId}-${globalThis.crypto.randomUUID()}`;
      const claimTime = new Date();
      const claimed = await this.outbox.claim({
        ownerId: OWNER,
        localId: candidate.localId,
        leaseToken,
        now: claimTime.toISOString(),
        leaseExpiresAt: new Date(claimTime.getTime() + LEASE_MS).toISOString(),
      });
      if (!claimed) {
        continue;
      }
      const request = toSyncCommandRequest(claimed);
      try {
        const response = await fetch('/__test/offline-sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': request.idempotencyKey,
          },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          throw new TypeError('Remote sync failed.');
        }
        const result = validateCommandResult(request, (await response.json()) as CommandResult);
        await this.outbox.reconcileSuccess({
          ownerId: OWNER,
          localId: claimed.localId,
          leaseToken,
          now: new Date().toISOString(),
          result,
        });
        outcomes.push({ localId: claimed.localId, status: 'SYNCED' });
      } catch {
        const failureTime = new Date().toISOString();
        await this.outbox.reconcileFailure({
          ownerId: OWNER,
          localId: claimed.localId,
          leaseToken,
          now: failureTime,
          status: 'RETRY_WAIT',
          nextAttemptAt: failureTime,
          error: {
            code: 'NETWORK',
            category: 'TRANSIENT',
            userMessage: 'Resposta indisponível; tentativa preservada.',
          },
        });
        outcomes.push({ localId: claimed.localId, status: 'RETRY_WAIT' });
      }
    }
    this.result.set(JSON.stringify({ tabId: this.tabId, outcomes }));
  }
}
