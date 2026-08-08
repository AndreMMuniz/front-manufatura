import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OPERATIONAL_COMMAND_TYPES } from '../../../core/offline/models/operational-command';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import {
  SynchronizationRecoveryRegistry,
  getRecoveryDefinition,
} from './synchronization-recovery-registry';
import { Router } from '@angular/router';
import {
  OperationalCorrectionContextService,
} from '../../../core/offline/services/operational-correction-context.service';

describe('SynchronizationRecoveryRegistry', () => {
  it('fecha a matriz dos 13 command types com rota e policy normativa', () => {
    expect(OPERATIONAL_COMMAND_TYPES.map(commandType => [
      commandType,
      getRecoveryDefinition(commandType).policy,
      getRecoveryDefinition(commandType).route,
    ])).toEqual([
      ['GENERATE_INSPECTION_ROUTE', 'CORRECTABLE', '/quality-control'],
      ['SAVE_MEASUREMENT', 'CORRECTABLE', '/quality-control'],
      ['FINISH_EXAM', 'RETRY_ONLY', '/quality-control'],
      ['STOP_INSPECTION_ROUTE', 'INTERVENTION', '/quality-control'],
      ['SAVE_INSPECTION', 'CORRECTABLE', '/quality-control'],
      ['START_OPERATION', 'CORRECTABLE', '/operation-reporting'],
      ['REPORT_OPERATION', 'CORRECTABLE', '/operation-reporting'],
      ['END_OPERATION', 'RETRY_ONLY', '/operation-reporting'],
      ['START_BATCH', 'CORRECTABLE', '/batch-reporting'],
      ['REPORT_BATCH', 'CORRECTABLE', '/batch-reporting'],
      ['END_BATCH', 'RETRY_ONLY', '/batch-reporting'],
      ['CREATE_STOP', 'CORRECTABLE', '/stoppages'],
      ['FINISH_STOP', 'CORRECTABLE', '/stoppages'],
    ]);
  });

  it('abre correção owner-scoped só com allowlist e remove segredos recursivamente', async () => {
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const outbox = {
      getById: vi.fn().mockResolvedValue({
        localId: 'local-1',
        ownerId: 'owner-1',
        status: 'ERROR',
        deliveryDisposition: 'ACTIVE',
        payloadSchemaVersion: 1,
        commandType: 'SAVE_MEASUREMENT',
        aggregateType: 'QUALITY_INSPECTION',
        aggregateId: 'R-1|E-1|C-1',
        payload: {
          routeNumber: 'R-1',
          examId: 'E-1',
          componentId: 'C-1',
          minimum: 1,
          maximum: 2,
          observation: 'Ajustar',
          status: 'REJECTED',
          operatorId: 'owner-1',
          savedAt: '2026-07-30T12:00:00.000Z',
          password: 'secret',
          nested: { token: 'secret' },
        },
      }),
    } as unknown as OutboxRepository;
    const auth = new AuthSessionService(null);
    auth.startSession({ id: 'owner-1', nome: 'Owner', login: 'owner', permissoes: [] }, 'token', { expiresAt: '2099-01-01T00:00:00.000Z' });
    const correctionContext = new OperationalCorrectionContextService(auth);
    const registry = new SynchronizationRecoveryRegistry(
      outbox,
      auth,
      { navigateByUrl } as unknown as Router,
      correctionContext,
    );

    expect(await registry.openCorrection('local-1')).toBe('opened');
    expect(outbox.getById).toHaveBeenCalledWith('owner-1', 'local-1');
    const navigation = navigateByUrl.mock.calls[0];
    expect(navigation[0]).toBe('/quality-control');
    expect(JSON.stringify(navigation[1])).not.toMatch(/secret|password|token|nested/i);
    expect(navigation[1]).toEqual(expect.objectContaining({
      state: {
        synchronizationRecovery: expect.objectContaining({
          sourceLocalId: 'local-1',
        }),
      },
    }));
    expect(correctionContext.current('owner-1')).toEqual(expect.objectContaining({
      sourceLocalId: 'local-1',
      draft: expect.objectContaining({
        routeNumber: 'R-1',
        componentId: 'C-1',
      }),
    }));
    expect(JSON.stringify(correctionContext.current('owner-1')))
      .not.toMatch(/secret|password|token|nested/i);
  });

  it('não cria editor/draft para tipo desconhecido, retry-only ou item stale', async () => {
    const navigateByUrl = vi.fn();
    const auth = new AuthSessionService(null);
    auth.startSession({ id: 'owner-1', nome: 'Owner', login: 'owner', permissoes: [] }, 'token', { expiresAt: '2099-01-01T00:00:00.000Z' });
    const outbox = {
      getById: vi.fn()
        .mockResolvedValueOnce({
          localId: 'unknown',
          ownerId: 'owner-1',
          status: 'ERROR',
          commandType: 'UNKNOWN',
          payloadSchemaVersion: 1,
          payload: {},
        })
        .mockResolvedValueOnce({
          localId: 'retry-only',
          ownerId: 'owner-1',
          status: 'ERROR',
          commandType: 'END_OPERATION',
          payloadSchemaVersion: 1,
          payload: {},
        }),
    } as unknown as OutboxRepository;
    const registry = new SynchronizationRecoveryRegistry(
      outbox,
      auth,
      { navigateByUrl } as unknown as Router,
    );

    expect(await registry.openCorrection('unknown')).toBe('unavailable');
    expect(await registry.openCorrection('retry-only')).toBe('unavailable');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
