import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../auth/auth-session.service';
import { SyncCommandRequest } from '../models/sync-command';
import {
  CreateStopSyncHandler,
  EndOperationSyncHandler,
  FinishStopSyncHandler,
  StartOperationSyncHandler,
} from './fma-sync.handlers';

describe('FMA sync handlers', () => {
  it('sends operation commands with bearer token and idempotency key', async () => {
    const post = vi.fn().mockReturnValue(of(receipt()));
    const handler = new StartOperationSyncHandler(
      { post } as never,
      { token: 'session-token' } as AuthSessionService,
    );
    const request = command('START_OPERATION', { ordem: '372562' });

    await expect(handler.send(request, new AbortController().signal)).resolves.toEqual(receipt());
    expect(post).toHaveBeenCalledWith('/api/operations/start', request.payload, {
      headers: expect.objectContaining({
        Authorization: 'Bearer session-token',
        'Idempotency-Key': request.idempotencyKey,
      }),
    });
  });

  it('uses the encoded local stop identity in the finish endpoint', async () => {
    const post = vi.fn().mockReturnValue(of(receipt()));
    const handler = new FinishStopSyncHandler(
      { post } as never,
      { token: 'session-token' } as AuthSessionService,
    );
    const request = command('FINISH_STOP', { stopLocalId: 'stop/01' });

    await handler.send(request, new AbortController().signal);
    expect(post).toHaveBeenCalledWith('/api/production-stops/stop%2F01/finish', request.payload, expect.any(Object));
  });

  it('sends END_OPERATION to the operation end gateway endpoint', async () => {
    const post = vi.fn().mockReturnValue(of(receipt()));
    const handler = new EndOperationSyncHandler(
      { post } as never,
      { token: 'session-token' } as AuthSessionService,
    );
    const request = command('END_OPERATION', {
      ordem: '372561', op: '10', split: '1', areaCode: '4104', ct: 'PRE-006-02',
    });

    await handler.send(request, new AbortController().signal);

    expect(post).toHaveBeenCalledWith('/api/operations/end', request.payload, expect.any(Object));
  });

  it('propaga a classificação e a mensagem pública devolvidas pelo gateway', async () => {
    const post = vi.fn().mockReturnValue(throwError(() => ({
      status: 409,
      error: {
        code: 'DATASUL_STOP_INTERVAL_CONFLICT',
        category: 'CONFLICT',
        userMessage: 'Já existe reporte neste intervalo de data e hora.',
      },
    })));
    const handler = new CreateStopSyncHandler(
      { post } as never,
      { token: 'session-token' } as AuthSessionService,
    );

    await expect(
      handler.send(command('CREATE_STOP', {}), new AbortController().signal),
    ).rejects.toEqual({
      status: 409,
      code: 'DATASUL_STOP_INTERVAL_CONFLICT',
      category: 'CONFLICT',
      userMessage: 'Já existe reporte neste intervalo de data e hora.',
    });
  });
});

function command(commandType: string, payload: Record<string, string>): SyncCommandRequest {
  return {
    localId: 'local-1',
    idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    payloadHash: 'hash',
    payloadSchemaVersion: 1,
    aggregateType: 'OPERATION',
    aggregateId: 'aggregate-1',
    commandType,
    payload,
    canonicalPayload: '{}',
    occurredAt: '2026-08-13T12:00:00.000Z',
  };
}

function receipt() {
  return {
    serverRecordId: 'datasul:record:1',
    idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    receivedAt: '2026-08-13T12:00:01.000Z',
    processedAt: '2026-08-13T12:00:01.000Z',
    duplicate: false,
  };
}
