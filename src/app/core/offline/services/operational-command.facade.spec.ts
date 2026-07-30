import { describe, expect, it, vi } from 'vitest';

import { OperationalCommandFacade } from './operational-command.facade';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('OperationalCommandFacade', () => {
  it('persists with the authenticated owner and triggers sync only after commit', async () => {
    const events: string[] = [];
    const repository = {
      persistConfirmedCommand: vi.fn(async () => {
        events.push('commit');
        return {
          localId: UUID,
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
});
