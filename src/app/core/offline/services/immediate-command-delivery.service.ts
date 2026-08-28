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
    let sessionEpoch = 0;
    const sessionSubscription = this.auth.session$?.subscribe(() => {
      sessionEpoch += 1;
    });
    try {
      const ownerId = this.auth.currentUser?.id.trim();
      const observedEpoch = sessionEpoch;
      if (!ownerId) {
        throw new OfflineStorageError(
          'PAYLOAD_INVALID',
          'Não existe owner autenticado para observar o envio.',
        );
      }

      await this.waitForCycle();
      this.assertCurrentSession(ownerId, observedEpoch, sessionEpoch);
      const entry = await this.outbox.getById(ownerId, localId);
      this.assertCurrentSession(ownerId, observedEpoch, sessionEpoch);
      if (!entry) {
        throw new OfflineStorageError(
          'CONFLICT',
          'O comando salvo não foi encontrado na Outbox.',
        );
      }
      if (entry.status === 'SYNCED') {
        if (!entry.receipt) {
          throw new OfflineStorageError(
            'SCHEMA_INVALID',
            'A confirmação sincronizada não possui receipt remoto.',
          );
        }
        return { status: 'SYNCED', receipt: entry.receipt };
      }
      if (entry.status === 'ERROR') {
        if (!entry.lastError) {
          throw new OfflineStorageError(
            'SCHEMA_INVALID',
            'O erro persistido não possui classificação segura.',
          );
        }
        return { status: 'ERROR', error: entry.lastError };
      }
      return { status: 'PENDING' };
    } finally {
      sessionSubscription?.unsubscribe();
    }
  }

  private assertCurrentSession(ownerId: string, observedEpoch: number, currentEpoch: number): void {
    if (
      currentEpoch !== observedEpoch
      || this.auth.currentUser?.id.trim() !== ownerId
    ) {
      throw new OfflineStorageError(
        'PAYLOAD_INVALID',
        'A sessão autenticada mudou durante a observação do envio.',
      );
    }
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
