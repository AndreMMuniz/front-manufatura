import { describe, expect, it, vi } from 'vitest';

import { OperationalCommandFacade } from './operational-command.facade';
import {
  OPERATIONAL_COMMAND_DEFINITIONS,
  OPERATIONAL_COMMAND_TYPES,
} from '../models/operational-command';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('OperationalCommandFacade', () => {
  it('persists with the authenticated owner and triggers sync only after commit', async () => {
    const events: string[] = [];
    const repository = {
      persistConfirmedCommand: vi.fn(async () => {
        events.push('commit');
        return {
          localId: UUID,
          localRecord: { aggregateId: '450001|10|01' },
          idempotencyKey: UUID,
          payloadHash: 'hash',
          committedAt: '2026-07-30T12:00:00.000Z',
          outboxEntry: { status: 'PENDING' },
        };
      }),
    };
    const trigger = { requestSync: vi.fn(() => events.push('trigger')) };
    const facade = new OperationalCommandFacade(
      repository as never,
      { currentUser: { id: 'operator-1' } } as never,
      trigger as never,
    );

    const confirmation = await facade.capture({
      commandType: 'START_OPERATION',
      aggregateId: '450001|10|01',
      businessStatus: 'INICIADA',
      idempotencyKey: UUID,
      occurredAt: '2026-07-30T12:00:00.000Z',
      payload: { order: '450001' },
    });

    expect(events).toEqual(['commit', 'trigger']);
    expect(repository.persistConfirmedCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'operator-1',
        aggregateType: 'OPERATION',
        commandType: 'START_OPERATION',
        payloadSchemaVersion: 1,
      }),
    );
    expect(confirmation).toEqual({
      localId: UUID,
      aggregateId: '450001|10|01',
      idempotencyKey: UUID,
      payloadHash: 'hash',
      committedAt: '2026-07-30T12:00:00.000Z',
      syncStatus: 'PENDING',
    });
  });

  it('fails before persistence when no authenticated owner exists', async () => {
    const repository = { persistConfirmedCommand: vi.fn() };
    const facade = new OperationalCommandFacade(
      repository as never,
      { currentUser: null } as never,
      { requestSync: vi.fn() } as never,
    );

    await expect(
      facade.capture({
        commandType: 'CREATE_STOP',
        aggregateId: UUID,
        businessStatus: 'EM_ANDAMENTO',
        payload: { reasonCode: '01' },
      }),
    ).rejects.toThrow('sessão autenticada');
    expect(repository.persistConfirmedCommand).not.toHaveBeenCalled();
  });

  it('confirma correção pela fachada semântica com novo comando e trigger após commit', async () => {
    const events: string[] = [];
    const repository = {
      persistSupersedingCommand: vi.fn(async () => {
        events.push('commit');
        return {
          localId: UUID,
          localRecord: { aggregateId: 'OP-1' },
          idempotencyKey: UUID,
          payloadHash: 'new-hash',
          committedAt: '2026-07-30T13:00:00.000Z',
          outboxEntry: { status: 'PENDING' },
        };
      }),
    };
    const facade = new OperationalCommandFacade(
      repository as never,
      { currentUser: { id: 'operator-1' } } as never,
      { requestSync: vi.fn(() => events.push('trigger')) } as never,
    );

    const result = await facade.captureCorrection('original-id', {
      commandType: 'REPORT_OPERATION',
      aggregateId: 'OP-1',
      businessStatus: 'REPORTADA',
      idempotencyKey: UUID,
      dependencyIds: ['create-id'],
      payload: { ordem: '100', quantidadeAprovada: 5 },
    });

    expect(events).toEqual(['commit', 'trigger']);
    expect(repository.persistSupersedingCommand).toHaveBeenCalledWith({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      originalLocalId: 'original-id',
        command: expect.objectContaining({
          ownerId: 'operator-1',
          commandType: 'REPORT_OPERATION',
          aggregateType: 'OPERATION',
          idempotencyKey: UUID,
          dependencyIds: ['create-id'],
      }),
    });
    expect(result.payloadHash).toBe('new-hash');
  });

  it('converte a próxima captura compatível em supersessão e limpa o contexto após commit', async () => {
    const repository = {
      persistSupersedingCommand: vi.fn(async () => ({
        localId: UUID,
        localRecord: { aggregateId: 'ORIGINAL-AGGREGATE' },
        idempotencyKey: UUID,
        payloadHash: 'corrected-hash',
        committedAt: '2026-07-30T13:00:00.000Z',
        outboxEntry: { status: 'PENDING' },
      })),
      persistConfirmedCommand: vi.fn(),
    };
    const correction = {
      matching: vi.fn().mockReturnValue({
        sourceLocalId: 'original-id',
        aggregateId: 'ORIGINAL-AGGREGATE',
      }),
      currentEpoch: vi.fn().mockReturnValue(7),
      isCurrent: vi.fn().mockReturnValue(true),
      watch: vi.fn().mockReturnValue(() => undefined),
      clear: vi.fn(),
    };
    const facade = new OperationalCommandFacade(
      repository as never,
      { currentUser: { id: 'operator-1' } } as never,
      { requestSync: vi.fn() } as never,
      correction as never,
    );

    await facade.capture({
      commandType: 'REPORT_OPERATION',
      aggregateId: 'FORM-GENERATED-AGGREGATE',
      businessStatus: 'REPORTADA',
      payload: { ordem: '100', quantidadeAprovada: 6 },
    });

    expect(repository.persistConfirmedCommand).not.toHaveBeenCalled();
    expect(repository.persistSupersedingCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        originalLocalId: 'original-id',
        command: expect.objectContaining({
          aggregateId: 'ORIGINAL-AGGREGATE',
          commandType: 'REPORT_OPERATION',
        }),
        sessionIsCurrent: expect.any(Function),
        watchSession: expect.any(Function),
      }),
    );
    expect(correction.clear).toHaveBeenCalledWith('original-id');
  });

  it.each(OPERATIONAL_COMMAND_TYPES)(
    'captures %s with the closed aggregate/version contract and no secret field',
    async (commandType) => {
      const repository = {
        persistConfirmedCommand: vi.fn(async (request: { initialSyncStatus?: string }) => ({
          localId: UUID,
          localRecord: { aggregateId: `aggregate-${commandType}` },
          idempotencyKey: UUID,
          payloadHash: 'hash',
          committedAt: '2026-07-30T12:00:00.000Z',
          outboxEntry: { status: request.initialSyncStatus ?? 'PENDING' },
        })),
      };
      const facade = new OperationalCommandFacade(
        repository as never,
        { currentUser: { id: 'operator-1' } } as never,
        { requestSync: vi.fn() } as never,
      );

      await facade.capture({
        commandType,
        aggregateId: `aggregate-${commandType}`,
        businessStatus: 'CONFIRMADO',
        idempotencyKey: UUID,
        payload: { safeValue: commandType },
      });

      const persisted = repository.persistConfirmedCommand.mock.calls[0][0];
      expect(persisted).toMatchObject({
        ownerId: 'operator-1',
        commandType,
        aggregateType: OPERATIONAL_COMMAND_DEFINITIONS[commandType].aggregateType,
        payloadSchemaVersion: OPERATIONAL_COMMAND_DEFINITIONS[commandType].payloadSchemaVersion,
      });
      expect(JSON.stringify(persisted)).not.toMatch(
        /password|senha|token|cookie|authorization|credential/i,
      );
    },
  );
});
