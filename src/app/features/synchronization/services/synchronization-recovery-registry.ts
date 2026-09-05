import { Injectable, Optional } from '@angular/core';
import { Router } from '@angular/router';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { deliveryDispositionOf } from '../../../core/offline/models/delivery-disposition';
import { JsonValue } from '../../../core/offline/models/local-record';
import {
  OPERATIONAL_COMMAND_TYPES,
  OperationalCommandType,
} from '../../../core/offline/models/operational-command';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { SynchronizationRecoveryPolicy } from '../models/synchronization-view.model';
import {
  OperationalCorrectionContextService,
} from '../../../core/offline/services/operational-correction-context.service';

export interface RecoveryDefinition {
  readonly route: string;
  readonly policy: SynchronizationRecoveryPolicy;
  readonly allowedFields: readonly string[];
}

const RECOVERY_DEFINITIONS: Readonly<Record<OperationalCommandType, RecoveryDefinition>> =
  Object.freeze({
    GENERATE_INSPECTION_ROUTE: correctable('/quality-control', [
      'orderNumber', 'operationCode', 'split', 'moveBalance',
    ]),
    SAVE_MEASUREMENT: correctable('/quality-control', [
      'routeNumber', 'examId', 'componentId', 'minimum', 'maximum',
      'observation', 'status', 'operatorId', 'savedAt',
    ]),
    FINISH_EXAM: retryOnly('/quality-control'),
    STOP_INSPECTION_ROUTE: intervention('/quality-control'),
    SAVE_INSPECTION: correctable('/quality-control', [
      'opNumber', 'operation', 'split', 'routeNumber', 'examCode',
      'measurements', 'status', 'createdAt',
    ]),
    SAVE_QUALITY_RESULT: correctable('/quality-control', [
      'orderNumber', 'nrFicha', 'codExame', 'codComponente', 'resultado', 'nrTabela',
      'seqOpcao', 'observation', 'operatorId', 'savedAt',
    ]),
    FINALIZE_QUALITY_ROUTE: retryOnly('/quality-control'),
    START_OPERATION: correctable('/operation-reporting', [
      'ordem', 'op', 'split', 'areaCode', 'workCenterCode', 'area',
      'workCenter', 'operation', 'operador', 'equipe', 'tipoResponsavel',
      'codigoResponsavel', 'dataInicio', 'horaInicio',
    ]),
    REPORT_OPERATION: correctable('/operation-reporting', [
      'ordem', 'op', 'split', 'quantidadeAprovada', 'quantidadeRetrabalho',
      'quantidadeRefugo', 'refugoItens', 'dataInicio', 'horaInicio', 'dataFim',
      'horaFim', 'operador', 'equipe', 'tipoResponsavel', 'codigoResponsavel', 'ct',
    ]),
    END_OPERATION: retryOnly('/operation-reporting'),
    START_BATCH: correctable('/batch-reporting', [
      'batchId', 'contexto', 'responsavel', 'ordens', 'iniciadoEm',
    ]),
    REPORT_BATCH: correctable('/batch-reporting', ['batchId', 'items']),
    END_BATCH: retryOnly('/batch-reporting'),
    CREATE_STOP: correctable('/stoppages', [
      'localId', 'context', 'reason', 'responsible', 'startDate', 'startTime',
      'endDate', 'endTime', 'status', 'durationMinutes',
    ]),
    FINISH_STOP: correctable('/stoppages', [
      'stopLocalId', 'areaCode', 'workCenterCode', 'endAt', 'endDate', 'endTime',
    ]),
    DELETE_STOP: retryOnly('/stoppages'),
    UPDATE_TEAM: retryOnly('/teams'),
  });

export type OpenCorrectionResult = 'opened' | 'unavailable' | 'stale';

@Injectable({ providedIn: 'root' })
export class SynchronizationRecoveryRegistry {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly auth: AuthSessionService,
    private readonly router: Router,
    @Optional()
    private readonly correctionContext: OperationalCorrectionContextService | null = null,
  ) {}

  async openCorrection(localId: string): Promise<OpenCorrectionResult> {
    const ownerId = this.auth.currentUser?.id.trim();
    if (!ownerId) return 'stale';
    const source = await this.outbox.getById(ownerId, localId);
    if (this.auth.currentUser?.id.trim() !== ownerId) return 'stale';
    if (
      !source
      || source.status !== 'ERROR'
      || deliveryDispositionOf(source.deliveryDisposition) !== 'ACTIVE'
      || source.payloadSchemaVersion !== 1
      || !isOperationalCommandType(source.commandType)
    ) {
      return 'unavailable';
    }
    const definition = getRecoveryDefinition(source.commandType);
    if (definition.policy !== 'CORRECTABLE') return 'unavailable';
    const draft = allowedPayload(source.payload, definition.allowedFields);
    if (this.auth.currentUser?.id.trim() !== ownerId) return 'stale';
    if (!this.correctionContext?.activate({
      ownerId,
      sourceLocalId: source.localId,
      commandType: source.commandType,
      aggregateType: source.aggregateType,
      aggregateId: source.aggregateId,
      payloadSchemaVersion: source.payloadSchemaVersion,
      draft,
    })) {
      return 'stale';
    }
    const navigated = await this.router.navigateByUrl(definition.route, {
      state: {
        synchronizationRecovery: Object.freeze({
          sourceLocalId: source.localId,
          commandType: source.commandType,
        }),
      },
    });
    if (!navigated || this.auth.currentUser?.id.trim() !== ownerId) {
      this.correctionContext.clear(source.localId);
      return 'stale';
    }
    return 'opened';
  }
}

export function getRecoveryDefinition(
  commandType: OperationalCommandType,
): RecoveryDefinition {
  return RECOVERY_DEFINITIONS[commandType];
}

function correctable(route: string, allowedFields: readonly string[]): RecoveryDefinition {
  return Object.freeze({
    route,
    policy: 'CORRECTABLE' as const,
    allowedFields: Object.freeze([...allowedFields]),
  });
}

function retryOnly(route: string): RecoveryDefinition {
  return Object.freeze({
    route,
    policy: 'RETRY_ONLY' as const,
    allowedFields: Object.freeze([]),
  });
}

function intervention(route: string): RecoveryDefinition {
  return Object.freeze({
    route,
    policy: 'INTERVENTION' as const,
    allowedFields: Object.freeze([]),
  });
}

function isOperationalCommandType(value: string): value is OperationalCommandType {
  return (OPERATIONAL_COMMAND_TYPES as readonly string[]).includes(value);
}

function allowedPayload(payload: JsonValue, allowedFields: readonly string[]): JsonValue {
  if (!isRecord(payload)) return {};
  const sanitized: Record<string, JsonValue> = {};
  for (const field of allowedFields) {
    if (Object.hasOwn(payload, field)) {
      const value = sanitizeValue(payload[field], field);
      if (value !== undefined) sanitized[field] = value;
    }
  }
  return deepFreeze(sanitized);
}

function sanitizeValue(value: JsonValue, key: string): JsonValue | undefined {
  if (/password|senha|token|credential|proof|prova|authorization/i.test(key)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeValue(item, 'item'))
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (isRecord(value)) {
    const sanitized: Record<string, JsonValue> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      const next = sanitizeValue(nestedValue, nestedKey);
      if (next !== undefined) sanitized[nestedKey] = next;
    }
    return sanitized;
  }
  return value;
}

function isRecord(value: unknown): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
