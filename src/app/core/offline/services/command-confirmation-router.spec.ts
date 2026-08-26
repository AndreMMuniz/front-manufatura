import { describe, expect, it, vi } from 'vitest';

import { SyncConfigurationError } from '../models/sync-error';
import { CommandConfirmationRouter } from './command-confirmation-router';

describe('CommandConfirmationRouter', () => {
  it('dispatches a read-only confirmation without invoking the send handler', async () => {
    const send = vi.fn();
    const confirm = vi.fn(async () => ({
      kind: 'MISSING' as const,
    }));
    const router = new CommandConfirmationRouter([
      { commandType: 'CREATE_STOP', confirm },
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

    await expect(router.confirm(request, new AbortController().signal)).resolves.toEqual({
      kind: 'MISSING',
    });

    expect(confirm).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(send).not.toHaveBeenCalled();
  });

  it('returns undefined for a command without a confirmation handler', async () => {
    const router = new CommandConfirmationRouter([]);

    await expect(router.confirm({ commandType: 'END_BATCH' } as never, new AbortController().signal))
      .resolves.toBeUndefined();
  });

  it('rejects duplicate confirmation handlers at configuration time', () => {
    const handler = {
      commandType: 'CREATE_STOP' as const,
      confirm: vi.fn(),
    };

    expect(() => new CommandConfirmationRouter([handler, handler]))
      .toThrowError(SyncConfigurationError);
  });
});
