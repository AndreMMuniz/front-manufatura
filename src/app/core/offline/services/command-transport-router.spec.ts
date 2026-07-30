import { describe, expect, it, vi } from 'vitest';

import { SyncConfigurationError } from '../models/sync-error';
import { CommandTransportRouter } from './command-transport-router';

describe('CommandTransportRouter', () => {
  it('dispatches by command type while preserving the original envelope', async () => {
    const send = vi.fn(async (request) => ({
      serverRecordId: 'server-1',
      idempotencyKey: request.idempotencyKey,
      receivedAt: '2026-07-30T12:00:00.000Z',
      processedAt: '2026-07-30T12:00:01.000Z',
      duplicate: false,
    }));
    const router = new CommandTransportRouter([
      { commandType: 'CREATE_STOP', send },
    ]);
    const request = {
      localId: 'local-1',
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      payloadHash: 'hash',
      payloadSchemaVersion: 1,
      aggregateType: 'STOP',
      aggregateId: 'stop-1',
      commandType: 'CREATE_STOP',
      payload: { reason: '01' },
      canonicalPayload: '{"reason":"01"}',
      occurredAt: '2026-07-30T12:00:00.000Z',
    } as const;

    await router.send(request, new AbortController().signal);

    expect(send).toHaveBeenCalledWith(request, expect.any(AbortSignal));
  });

  it('fails explicitly when no adapter is registered', async () => {
    const router = new CommandTransportRouter([]);

    await expect(
      router.send({
        localId: 'local-1',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
        payloadHash: 'hash',
        payloadSchemaVersion: 1,
        aggregateType: 'BATCH',
        aggregateId: 'batch-1',
        commandType: 'END_BATCH',
        payload: { orderIds: ['1'] },
        canonicalPayload: '{"orderIds":["1"]}',
        occurredAt: '2026-07-30T12:00:00.000Z',
      }, new AbortController().signal),
    ).rejects.toBeInstanceOf(SyncConfigurationError);
  });

  it('falha cedo quando dois adapters registram o mesmo tipo de comando', () => {
    const handler = {
      commandType: 'CREATE_STOP' as const,
      send: vi.fn(),
    };

    expect(() => new CommandTransportRouter([handler, handler]))
      .toThrowError(/mais de um adapter/i);
  });
});
