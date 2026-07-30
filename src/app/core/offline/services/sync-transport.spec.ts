import { describe, expect, it, vi } from 'vitest';

import { JsonValue } from '../models/local-record';
import { OutboxEntry } from '../models/outbox-entry';
import { CommandResult, SyncCommandRequest } from '../models/sync-command';
import { normalizeCommandError } from '../models/sync-error';
import {
  MissingSyncTransport,
  SyncTransport,
  TimeoutScheduler,
  sendCommandWithTimeout,
  toSyncCommandRequest,
  validateCommandResult,
} from './sync-transport';

describe('sync transport contract', () => {
  it('envia snapshot persistido sem lease, erro ou credencial e preserva chave/conteúdo', () => {
    const persisted = entry();
    const request = toSyncCommandRequest(persisted);

    expect(request).toEqual({
      localId: 'command-1',
      idempotencyKey: 'key-1',
      payloadHash: 'hash-1',
      payloadSchemaVersion: 2,
      aggregateType: 'REPORT',
      aggregateId: 'OP-1',
      commandType: 'CONFIRM_REPORT',
      payload: { quantity: 5 },
      canonicalPayload: '{"quantity":5}',
      occurredAt: '2026-07-29T12:00:00.000Z',
    });
    expect(JSON.stringify(request)).not.toMatch(/lease|token|cookie|senha|credential/i);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('valida identidade e campos seguros do receipt retornado', () => {
    const request = toSyncCommandRequest(entry());
    const result = receipt();

    expect(validateCommandResult(request, result)).toEqual(result);
    expect(() =>
      validateCommandResult(request, { ...result, idempotencyKey: 'other-key' }),
    ).toThrowError(/idempotência/i);
    expect(() =>
      validateCommandResult(request, { ...result, processedAt: 'invalid' }),
    ).toThrowError(/receipt/i);
  });

  it('aceita somente reconciliação multiordem integral, sem ausências ou duplicatas', () => {
    const request = toSyncCommandRequest(entry({
      commandType: 'REPORT_BATCH',
      aggregateType: 'BATCH',
      payload: { items: [{ orderId: '1' }, { orderId: '2' }] },
    }));
    const complete: CommandResult = {
      ...receipt(),
      orderResults: [
        { orderId: '1', success: true, serverRecordId: 'server-order-1' },
        { orderId: '2', success: true, serverRecordId: 'server-order-2' },
      ],
    };

    expect(validateCommandResult(request, complete)).toEqual(complete);
    expect(() => validateCommandResult(request, {
      ...complete,
      orderResults: [{ orderId: '1', success: true }],
    })).toThrow(/multiordem/i);
    expect(() => validateCommandResult(request, {
      ...complete,
      orderResults: [
        { orderId: '1', success: true },
        { orderId: '1', success: true },
      ],
    })).toThrow(/multiordem/i);
    expect(() => validateCommandResult(request, {
      ...complete,
      orderResults: [
        { orderId: '1', success: true },
        { orderId: '2', success: false, errorCode: 'VALIDATION' },
      ],
    })).toThrow(/multiordem/i);
  });

  it('controla timeout com scheduler injetado e aborta o transporte', async () => {
    let timeoutCallback = () => undefined;
    const scheduler: TimeoutScheduler = {
      schedule: (callback) => {
        timeoutCallback = callback;
        return () => undefined;
      },
    };
    const transport: SyncTransport = {
      send: vi.fn(
        (_request, signal) =>
          new Promise<CommandResult>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      ),
    };

    const pending = sendCommandWithTimeout(
      transport,
      toSyncCommandRequest(entry()),
      30_000,
      scheduler,
    );
    timeoutCallback();

    await expect(pending).rejects.toMatchObject({ name: 'SyncTimeoutError' });
  });

  it('cancela o timer quando o transporte lança sincronicamente', async () => {
    const cancel = vi.fn();
    const scheduler: TimeoutScheduler = {
      schedule: () => cancel,
    };
    const transport: SyncTransport = {
      send: () => {
        throw new TypeError('falha síncrona');
      },
    };

    await expect(
      sendCommandWithTimeout(
        transport,
        toSyncCommandRequest(entry()),
        30_000,
        scheduler,
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('propaga cancelamento externo e limpa o timeout', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const transport: SyncTransport = {
      send: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    };
    const pending = sendCommandWithTimeout(
      transport,
      toSyncCommandRequest(entry()),
      30_000,
      { schedule: () => cancel },
      controller.signal,
    );

    controller.abort(new Error('sessão alterada'));

    await expect(pending).rejects.toThrow('sessão alterada');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('falha permanentemente quando não existe adapter para o comando', async () => {
    await expect(
      new MissingSyncTransport().send(toSyncCommandRequest(entry()), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_COMMAND',
      category: 'CONFIGURATION',
    });
  });

  it('prova sucesso original, replay idêntico, conflito divergente e resposta perdida', async () => {
    const server = new ContractFakeServer();
    const request = toSyncCommandRequest(entry());
    const original = await server.send(request, new AbortController().signal);
    const replay = await server.send(request, new AbortController().signal);

    expect(original).toMatchObject({ serverRecordId: 'server-1', duplicate: false });
    expect(replay).toMatchObject({
      serverRecordId: original.serverRecordId,
      processedAt: original.processedAt,
      duplicate: true,
    });
    await expect(
      server.send({ ...request, payloadHash: 'different' }, new AbortController().signal),
    ).rejects.toMatchObject({ category: 'CONFLICT' });

    const lostResponse = toSyncCommandRequest(entry({ idempotencyKey: 'lost-key' }));
    server.loseNextResponse = true;
    await expect(
      server.send(lostResponse, new AbortController().signal),
    ).rejects.toBeInstanceOf(TypeError);
    const recovered = await server.send(lostResponse, new AbortController().signal);
    expect(recovered).toMatchObject({ serverRecordId: 'server-2', duplicate: true });
  });

  it('categoriza request simultânea conforme contrato explícito, sem inferir sucesso', async () => {
    const server = new ContractFakeServer();
    const request = toSyncCommandRequest(entry());
    server.holdNextRequest = true;

    const first = server.send(request, new AbortController().signal);
    await expect(
      server.send(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', category: 'TRANSIENT' });
    server.releaseHeldRequest();
    await expect(first).resolves.toMatchObject({ duplicate: false });
    expect(normalizeCommandError({ status: 409, category: 'TRANSIENT' })).toMatchObject({
      category: 'TRANSIENT',
    });
  });
});

class ContractFakeServer implements SyncTransport {
  private readonly results = new Map<string, { hash: string; result: CommandResult }>();
  private readonly processing = new Set<string>();
  private release?: () => void;
  loseNextResponse = false;
  holdNextRequest = false;

  async send(request: SyncCommandRequest, _signal: AbortSignal): Promise<CommandResult> {
    const persisted = this.results.get(request.idempotencyKey);
    if (persisted) {
      if (persisted.hash !== request.payloadHash) {
        throw {
          code: 'IDEMPOTENCY_CONFLICT',
          category: 'CONFLICT',
          userMessage: 'A chave identifica outro conteúdo.',
        };
      }
      return { ...persisted.result, duplicate: true };
    }
    if (this.processing.has(request.idempotencyKey)) {
      throw {
        status: 409,
        code: 'IDEMPOTENCY_IN_PROGRESS',
        category: 'TRANSIENT',
        userMessage: 'O comando ainda está em processamento.',
      };
    }

    this.processing.add(request.idempotencyKey);
    if (this.holdNextRequest) {
      this.holdNextRequest = false;
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    const index = this.results.size + 1;
    const result: CommandResult = {
      serverRecordId: `server-${index}`,
      idempotencyKey: request.idempotencyKey,
      receivedAt: '2026-07-29T13:00:00.000Z',
      processedAt: '2026-07-29T13:00:01.000Z',
      duplicate: false,
    };
    this.results.set(request.idempotencyKey, { hash: request.payloadHash, result });
    this.processing.delete(request.idempotencyKey);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TypeError('Failed to fetch');
    }
    return result;
  }

  releaseHeldRequest(): void {
    this.release?.();
    this.release = undefined;
  }
}

function receipt(): CommandResult {
  return {
    serverRecordId: 'server-1',
    idempotencyKey: 'key-1',
    receivedAt: '2026-07-29T13:00:00.000Z',
    processedAt: '2026-07-29T13:00:01.000Z',
    duplicate: false,
    correlationId: 'corr-1',
  };
}

function entry(overrides: Partial<OutboxEntry<JsonValue>> = {}): OutboxEntry<JsonValue> {
  return {
    localId: 'command-1',
    idempotencyKey: 'key-1',
    payloadSchemaVersion: 2,
    aggregateType: 'REPORT',
    aggregateId: 'OP-1',
    commandType: 'CONFIRM_REPORT',
    payload: { quantity: 5 },
    canonicalPayload: '{"quantity":5}',
    payloadHash: 'hash-1',
    ownerId: 'operator-1',
    status: 'SYNCING',
    dependencyIds: [],
    attemptCount: 1,
    occurredAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T13:00:00.000Z',
    leaseToken: 'lease-1',
    leaseExpiresAt: '2026-07-29T13:01:00.000Z',
    ...overrides,
  };
}
