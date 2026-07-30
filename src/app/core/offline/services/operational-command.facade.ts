import { Injectable } from '@angular/core';

import { AuthSessionService } from '../../auth/auth-session.service';
import {
  CaptureOperationalCommandRequest,
  LocalCommandConfirmation,
  OPERATIONAL_COMMAND_DEFINITIONS,
} from '../models/operational-command';
import { OfflineStorageError } from '../models/offline-storage-error';
import { LocalCommandRepository } from '../repositories/local-command.repository';
import { SyncTriggerService } from './sync-trigger.service';

@Injectable({ providedIn: 'root' })
export class OperationalCommandFacade {
  constructor(
    private readonly repository: LocalCommandRepository,
    private readonly authSession: AuthSessionService,
    private readonly syncTrigger: SyncTriggerService,
  ) {}

  async capture(
    request: CaptureOperationalCommandRequest,
  ): Promise<LocalCommandConfirmation> {
    const ownerId = this.authSession.currentUser?.id.trim();
    if (!ownerId) {
      throw new OfflineStorageError(
        'PAYLOAD_INVALID',
        'É necessária uma sessão autenticada para salvar o comando neste dispositivo.',
      );
    }

    const definition = OPERATIONAL_COMMAND_DEFINITIONS[request.commandType];
    const persisted = await this.repository.persistConfirmedCommand({
      ownerId,
      aggregateType: definition.aggregateType,
      aggregateId: request.aggregateId,
      commandType: request.commandType,
      payloadSchemaVersion: definition.payloadSchemaVersion,
      payload: request.payload,
      businessStatus: request.businessStatus,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.occurredAt ? { occurredAt: request.occurredAt } : {}),
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      ...(request.initialSyncStatus
        ? {
            initialSyncStatus: request.initialSyncStatus,
            ...(request.initialSyncStatus === 'BLOCKED_AUTH'
              ? { initialAuthBlockReason: 'SUPERVISOR' as const }
              : {}),
          }
        : {}),
    });

    this.syncTrigger.requestSync();
    return Object.freeze({
      localId: persisted.localId,
      idempotencyKey: persisted.idempotencyKey,
      payloadHash: persisted.payloadHash,
      committedAt: persisted.committedAt,
      syncStatus: persisted.outboxEntry.status === 'BLOCKED_AUTH'
        ? 'BLOCKED_AUTH'
        : 'PENDING',
    });
  }
}
