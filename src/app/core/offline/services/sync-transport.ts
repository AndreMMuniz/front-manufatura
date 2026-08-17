import { inject, InjectionToken } from '@angular/core';

import { JsonValue } from '../models/local-record';
import { OutboxEntry } from '../models/outbox-entry';
import { CommandResult, SyncCommandRequest } from '../models/sync-command';
import { SyncConfigurationError, SyncTimeoutError } from '../models/sync-error';
import {
  CommandTransportRouter,
  SYNC_COMMAND_HANDLERS,
} from './command-transport-router';

export interface SyncTransport {
  /**
   * Implementações HTTP devem obter autenticação apenas em memória e enviar
   * request.idempotencyKey no header `Idempotency-Key`.
   */
  readonly send: (
    request: SyncCommandRequest,
    signal: AbortSignal,
  ) => Promise<CommandResult>;
}

export interface TimeoutScheduler {
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
}

export const SYNC_TIMEOUT_SCHEDULER = new InjectionToken<TimeoutScheduler>(
  'SYNC_TIMEOUT_SCHEDULER',
  {
    providedIn: 'root',
    factory: () => ({
      schedule: (callback, delayMs) => {
        const handle = globalThis.setTimeout(callback, delayMs);
        return () => globalThis.clearTimeout(handle);
      },
    }),
  },
);

export class MissingSyncTransport implements SyncTransport {
  send(_request: SyncCommandRequest, _signal: AbortSignal): Promise<CommandResult> {
    return Promise.reject(
      new SyncConfigurationError(
        'UNSUPPORTED_COMMAND',
        'Não existe adapter Datasul configurado para este tipo de comando.',
      ),
    );
  }
}

export const SYNC_TRANSPORT = new InjectionToken<SyncTransport>('SYNC_TRANSPORT', {
  providedIn: 'root',
  factory: () =>
    new CommandTransportRouter(inject(SYNC_COMMAND_HANDLERS, { optional: true }) ?? []),
});

export function toSyncCommandRequest(
  entry: OutboxEntry<JsonValue>,
  supervisorProof?: unknown,
): SyncCommandRequest {
  return immutableCopy({
    localId: entry.localId,
    idempotencyKey: entry.idempotencyKey,
    payloadHash: entry.payloadHash,
    payloadSchemaVersion: entry.payloadSchemaVersion,
    aggregateType: entry.aggregateType,
    aggregateId: entry.aggregateId,
    commandType: entry.commandType,
    payload: entry.payload,
    canonicalPayload: entry.canonicalPayload,
    occurredAt: entry.occurredAt,
    ...(supervisorProof !== undefined ? { supervisorProof } : {}),
  });
}

export function validateCommandResult(
  request: SyncCommandRequest,
  result: CommandResult,
): CommandResult {
  if (result.idempotencyKey !== request.idempotencyKey) {
    throw new SyncConfigurationError(
      'RECEIPT_IDEMPOTENCY_MISMATCH',
      'O receipt remoto não corresponde à chave de idempotência enviada.',
    );
  }
  if (
    !safeIdentifier(result.serverRecordId) ||
    !validIso(result.receivedAt) ||
    !validIso(result.processedAt) ||
    typeof result.duplicate !== 'boolean' ||
    (result.correlationId !== undefined && !safeIdentifier(result.correlationId))
  ) {
    throw new SyncConfigurationError(
      'INVALID_RECEIPT',
      'O receipt remoto é inválido para reconciliação.',
    );
  }
  if (request.commandType.endsWith('_BATCH')) {
    validateBatchReconciliation(request, result);
  }
  return immutableCopy(result);
}

export function sendCommandWithTimeout(
  transport: SyncTransport,
  request: SyncCommandRequest,
  timeoutMs: number,
  scheduler: TimeoutScheduler,
  externalSignal?: AbortSignal,
): Promise<CommandResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(
      new SyncConfigurationError('INVALID_TIMEOUT', 'O timeout remoto configurado é inválido.'),
    );
  }

  const controller = new AbortController();
  return new Promise<CommandResult>((resolve, reject) => {
    let settled = false;
    let cancel = () => undefined;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cancel();
      callback();
    };
    const cancelTimer = scheduler.schedule(() => {
      const timeout = new SyncTimeoutError();
      controller.abort(timeout);
      finish(() => reject(timeout));
    }, timeoutMs);
    const abortFromExternal = () => {
      const reason = externalSignal?.reason ?? new Error('A sincronização foi cancelada.');
      controller.abort(reason);
      finish(() => reject(reason));
    };
    cancel = () => {
      cancelTimer();
      externalSignal?.removeEventListener('abort', abortFromExternal);
    };
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    if (externalSignal?.aborted) {
      abortFromExternal();
      return;
    }

    Promise.resolve()
      .then(() => transport.send(request, controller.signal))
      .then(
      (result) => finish(() => resolve(validateCommandResult(request, result))),
      (error: unknown) => finish(() => reject(error)),
      );
  });
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function validIso(value: string): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function safeIdentifier(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/.test(value);
}

function safeOrderIdentifier(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9._:/|-]{1,160}$/.test(value);
}

function validateBatchReconciliation(
  request: SyncCommandRequest,
  result: CommandResult,
): void {
  const expected = batchOrderIds(request.payload);
  const received = result.orderResults ?? [];
  const unique = new Set(received.map(item => item.orderId));
  const complete =
    expected.length > 0
    && new Set(expected).size === expected.length
    && expected.every(safeOrderIdentifier)
    && received.length === expected.length
    && unique.size === received.length
    && received.every(item =>
      item.success
      && safeOrderIdentifier(item.orderId)
      && expected.includes(item.orderId)
      && (item.serverRecordId === undefined || safeIdentifier(item.serverRecordId)))
    && expected.every(orderId => unique.has(orderId));
  if (!complete) {
    throw new SyncConfigurationError(
      'INCOMPLETE_BATCH_RECONCILIATION',
      'O receipt multiordem não reconciliou integralmente a composição enviada.',
    );
  }
}

function batchOrderIds(payload: JsonValue): readonly string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }
  const record = payload as { readonly [key: string]: JsonValue };
  const direct = record['orderIds'];
  if (Array.isArray(direct)) {
    return direct.filter((value): value is string => typeof value === 'string');
  }
  const items = record['items'] ?? record['ordens'];
  if (!Array.isArray(items)) {
    return [];
  }
  return items.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const candidate = item as { readonly [key: string]: JsonValue };
    const orderId = candidate['orderId'] ?? candidate['id'];
    return typeof orderId === 'string' ? [orderId] : [];
  });
}
