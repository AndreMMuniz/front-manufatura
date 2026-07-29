import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { LocalCommandRepository } from '../repositories/local-command.repository';
import { OutboxRepository } from '../repositories/outbox.repository';
import { PWA_BUILD_VERSION } from './pwa-build-version';

const OWNER_ID = 'playwright-pwa-owner';
const COMMAND_ID = '423e4567-e89b-42d3-a456-426614174000';

@Component({
  selector: 'app-pwa-offline-harness',
  template: `
    <span data-testid="pwa-version">{{ version }}</span>
    <button type="button" data-testid="seed-pending" (click)="seedPending()">Seed pending</button>
    <button type="button" data-testid="verify-pending" (click)="verifyPending()">
      Verify pending
    </button>
    <pre data-testid="pwa-result">{{ result() }}</pre>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PwaOfflineHarness {
  private readonly commands = inject(LocalCommandRepository);
  private readonly outbox = inject(OutboxRepository);

  readonly version = PWA_BUILD_VERSION;
  readonly result = signal('');

  async seedPending(): Promise<void> {
    const persisted = await this.commands.persistConfirmedCommand({
      ownerId: OWNER_ID,
      aggregateType: 'PLAYWRIGHT_PWA',
      aggregateId: 'PWA-A-B',
      commandType: 'CONFIRM_PWA_PROBE',
      payload: { quantity: 7, note: 'sem segredo' },
      payloadSchemaVersion: 1,
      idempotencyKey: COMMAND_ID,
      occurredAt: '2026-07-29T12:00:00.000Z',
    });
    this.writeResult(persisted.outboxEntry);
  }

  async verifyPending(): Promise<void> {
    this.writeResult(await this.outbox.getById(OWNER_ID, COMMAND_ID));
  }

  private writeResult(entry: Awaited<ReturnType<OutboxRepository['getById']>>): void {
    this.result.set(JSON.stringify({
      version: this.version,
      status: entry?.status,
      localId: entry?.localId,
      idempotencyKey: entry?.idempotencyKey,
      payloadHash: entry?.payloadHash,
      payload: entry?.payload,
    }));
  }
}
