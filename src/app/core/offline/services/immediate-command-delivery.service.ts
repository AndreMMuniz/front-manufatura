import { Inject, Injectable } from '@angular/core';

import { AuthSessionService } from '../../auth/auth-session.service';
import { ImmediateDeliveryResult } from '../models/immediate-delivery-result';
import { OfflineStorageError } from '../models/offline-storage-error';
import { SyncSchedulerConfig } from '../models/sync-error';
import { OutboxRepository } from '../repositories/outbox.repository';
import { SyncCoordinatorService } from './sync-coordinator.service';
import { SYNC_TIMEOUT_SCHEDULER, TimeoutScheduler } from './sync-transport';
import { SYNC_SCHEDULER_CONFIGURATION } from './sync-trigger.service';

@Injectable({ providedIn: 'root' })
export class ImmediateCommandDeliveryService {
  constructor(
    private readonly coordinator: SyncCoordinatorService,
    private readonly outbox: OutboxRepository,
    private readonly auth: AuthSessionService,
    @Inject(SYNC_SCHEDULER_CONFIGURATION) private readonly config: SyncSchedulerConfig,
    @Inject(SYNC_TIMEOUT_SCHEDULER) private readonly scheduler: TimeoutScheduler,
  ) {}

  async deliver(localId: string): Promise<ImmediateDeliveryResult> {
    const ownerId = this.auth.currentUser?.id.trim();
    if (!ownerId) {
      throw new OfflineStorageError(
        'PAYLOAD_INVALID',
        'Não existe owner autenticado para observar o envio.',
      );
    }

    await this.waitForCycle();
    const entry = await this.outbox.getById(ownerId, localId);
    if (!entry) {
      throw new OfflineStorageError(
        'CONFLICT',
        'O comando salvo não foi encontrado na Outbox.',
      );
    }
    if (entry.status === 'SYNCED' && entry.receipt) {
      return { status: 'SYNCED', receipt: entry.receipt };
    }
    if (entry.status === 'ERROR' && entry.lastError) {
      return { status: 'ERROR', error: entry.lastError };
    }
    return { status: 'PENDING' };
  }

  private waitForCycle(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      const cancel = this.scheduler.schedule(finish, this.config.requestTimeoutMs);
      void this.coordinator.requestSync().then(
        () => {
          cancel();
          finish();
        },
        () => {
          cancel();
          finish();
        },
      );
    });
  }
}
