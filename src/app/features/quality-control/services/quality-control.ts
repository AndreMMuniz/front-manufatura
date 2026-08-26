import { Inject, Injectable, InjectionToken, Optional } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, map, of, startWith, switchMap, throwError } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { LocalRecordRepository } from '../../../core/offline/repositories/local-record.repository';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { SupervisorProofVault } from '../../../core/offline/services/supervisor-proof-vault';
import { SyncTriggerService } from '../../../core/offline/services/sync-trigger.service';
import { OutboxActivityService } from '../../../core/offline/services/outbox-activity.service';

import {
  GenerateInspectionRouteRequest,
  ProductionOrderOperationsResult,
  ProductionOrderRoute,
} from '../models/production-order-route';
import { QualityComponentStatus, QualityExam, QualityExamComponent } from '../models/quality-exam';
import { QualityMeasurement } from '../models/quality-exam';
import {
  ReactionPlanAuthorization,
  ReactionPlanAuthorizationRequest,
} from '../models/reaction-plan-authorization';
import {
  MeasurementValidationResult,
  SaveMeasurementRequest,
  SaveMeasurementResponse,
  SaveInspectionPayload,
  SaveInspectionResult,
} from '../models/inspection-record';
import {
  mapInspectionRouteEnvelope,
  mapProductionOrderEnvelope,
} from '../mappers/datasul-quality-control.mapper';

export interface StopInspectionRouteRequest {
  routeNumber: string;
  routeLocalId?: string;
  examId: string;
  reason: string;
  idempotencyKey?: string;
  dependencyIds?: readonly string[];
}

export interface StopInspectionRouteResponse {
  routeNumber: string;
  examId: string;
  reason: string;
  stoppedAt: Date;
}

export interface ReactionPlanAuthorizationResult {
  readonly supervisorAuthorizationId: string;
  readonly proof: unknown;
  readonly expiresAt: Date;
}

export interface ReactionPlanAuthorizationAdapter {
  authorize(
    request: ReactionPlanAuthorizationRequest,
  ): Promise<ReactionPlanAuthorizationResult>;
}

export interface RestoredQualityWorkflow {
  readonly route: ProductionOrderRoute;
  readonly measurements: ReadonlyArray<{
    readonly examId: string;
    readonly componentId: string;
    readonly measurement: QualityMeasurement;
  }>;
  readonly finishCommandIds: Readonly<Record<string, string>>;
  readonly inspectionCommandIds: Readonly<Record<string, string>>;
}

export interface QualityMeasurementDeliveryUpdate {
  readonly deliveryStatus: 'PENDING' | 'SYNCED' | 'ERROR';
  readonly withinRange?: boolean;
}

export interface QualityRouteFinalizationDeliveryUpdate {
  readonly deliveryStatus: 'PENDING' | 'SYNCED' | 'ERROR';
  readonly finalizado?: boolean;
  readonly inspecionado?: boolean;
  readonly componentesPendentes?: number;
  readonly mensagem?: string;
}

export const REACTION_PLAN_AUTHORIZER =
  new InjectionToken<ReactionPlanAuthorizationAdapter>('REACTION_PLAN_AUTHORIZER');

@Injectable({ providedIn: 'root' })
export class QualityControlService {
  constructor(
    private readonly commands: OperationalCommandFacade,
    @Optional()
    @Inject(REACTION_PLAN_AUTHORIZER)
    private readonly reactionPlanAuthorizer?: ReactionPlanAuthorizationAdapter,
    @Optional() private readonly authSession?: AuthSessionService,
    @Optional() private readonly supervisorProofs?: SupervisorProofVault,
    @Optional() private readonly outbox?: OutboxRepository,
    @Optional() private readonly syncTrigger?: SyncTriggerService,
    @Optional() private readonly localRecords?: LocalRecordRepository,
    @Optional() private readonly http: HttpClient | null = null,
    @Optional() private readonly outboxActivity: OutboxActivityService | null = null,
  ) {}

  getProductionOrderOperations(orderNumber: string): Observable<ProductionOrderOperationsResult> {
    const numeric = Number(orderNumber);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      return throwError(() => new Error('invalid-order-number'));
    }
    return this.httpClient().get<unknown>(
      `/api/quality-control/orders/${numeric}`,
      { headers: this.authHeaders() },
    ).pipe(map(mapProductionOrderEnvelope));
  }

  generateInspectionRoute(
    request: GenerateInspectionRouteRequest,
  ): Observable<ProductionOrderRoute> {
    const orderNumber = Number(request.orderNumber);
    const operationCode = Number(request.operation.operationCode);
    const responsibleCode = request.responsibleCode?.trim() ?? '';
    if (
      !Number.isSafeInteger(orderNumber) || orderNumber <= 0
      || !Number.isSafeInteger(operationCode) || operationCode <= 0
      || (request.responsibleType !== 'OPERADOR' && request.responsibleType !== 'EQUIPE')
      || !responsibleCode
    ) {
      return throwError(() => new Error('invalid-route-request'));
    }
    const responsible = request.responsibleType === 'EQUIPE'
      ? { codEquipe: responsibleCode }
      : { codOperador: responsibleCode };
    return this.httpClient().post<unknown>(
      '/api/quality-control/routes',
      { nrOrdemProducao: orderNumber, codOperacao: operationCode, ...responsible },
      { headers: this.authHeaders() },
    ).pipe(map(value => mapInspectionRouteEnvelope(value, {
      orderNumber: request.orderNumber,
      operation: request.operation,
    }).route));
  }

  getQualityExams(route: ProductionOrderRoute): Observable<QualityExam[]> {
    return of([...(route.exams ?? [])]);
  }

  restoreLatestConfirmedRoute(): Observable<RestoredQualityWorkflow | null> {
    const ownerId = this.authSession?.currentUser?.id.trim();
    if (!ownerId || !this.localRecords) return of(null);
    return from(this.localRecords.listByOwner(ownerId)).pipe(map(records => {
      const generated = [...records]
        .filter(record => record.commandType === 'GENERATE_INSPECTION_ROUTE')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (!generated) return null;
      const stopped = records.some(record =>
        record.commandType === 'STOP_INSPECTION_ROUTE'
        && record.aggregateId === generated.localId
        && record.createdAt >= generated.createdAt);
      if (stopped) return null;
      const payload = generated.payload as Record<string, unknown>;
      if (
        !nonEmptyText(payload['orderNumber'])
        || !nonEmptyText(payload['operationCode'])
        || !nonEmptyText(payload['itemCode'])
      ) {
        return null;
      }
      const route: ProductionOrderRoute = {
        localId: generated.localId,
        creationCommandId: generated.idempotencyKey,
        routeNumber: nonEmptyText(payload['routeNumber'])
          ? payload['routeNumber']
          : generated.localId,
        processDescription: textOr(payload['processDescription'], ''),
        currentOrder: payload['orderNumber'],
        operationCode: payload['operationCode'],
        operationDescription: textOr(
          payload['operationDescription'],
          payload['operationCode'],
        ),
        split: textOr(payload['split'], '1'),
        itemCode: payload['itemCode'],
        itemDescription: textOr(payload['itemDescription'], ''),
      };
      const measurements = records
        .filter(record =>
          (record.commandType === 'SAVE_QUALITY_RESULT' || record.commandType === 'SAVE_MEASUREMENT')
          && (record.aggregateId === generated.localId
            || record.dependencyIds.includes(generated.idempotencyKey)))
        .flatMap(record => {
          const value = record.payload as Record<string, unknown>;
          if (!nonEmptyText(value['examId']) || !nonEmptyText(value['componentId'])) {
            return [];
          }
          const result = typeof value['resultado'] === 'number' ? value['resultado'] : undefined;
          const maximumResult = typeof value['resultadoMax'] === 'number' ? value['resultadoMax'] : undefined;
          const report = nonEmptyText(value['laudo']) ? value['laudo'] : undefined;
          const tableNumber = typeof value['nrTabela'] === 'number' ? value['nrTabela'] : undefined;
          const optionSequence = typeof value['seqOpcao'] === 'number' ? value['seqOpcao'] : undefined;
          if (result === undefined && report === undefined
            && (tableNumber === undefined || optionSequence === undefined)) return [];
          return [{
            examId: value['examId'],
            componentId: value['componentId'],
            measurement: {
              ...(result !== undefined ? { result } : {}),
              ...(maximumResult !== undefined ? { maximumResult } : {}),
              ...(report !== undefined ? { report } : {}),
              ...(tableNumber !== undefined && optionSequence !== undefined
                ? { selectedOption: { tableNumber, sequence: optionSequence, description: textOr(value['optionDescription'], '') } }
                : {}),
              status: 'RECORDED' as const,
              deliveryStatus: 'PENDING' as const,
              ...(nonEmptyText(value['observation'])
                ? { observation: value['observation'] }
                : {}),
              ...(nonEmptyText(value['operatorId']) ? { operatorId: value['operatorId'] } : {}),
              savedAt: new Date(record.createdAt),
              commandId: record.idempotencyKey,
            },
          }];
        });
      const finishCommandIds = Object.fromEntries(records
        .filter(record =>
          record.commandType === 'FINALIZE_QUALITY_ROUTE'
          && record.aggregateId === generated.localId)
        .flatMap(record => {
          const value = record.payload as Record<string, unknown>;
          return nonEmptyText(value['examId'])
            ? [[value['examId'], record.idempotencyKey] as const]
            : [];
        }));
      const inspectionCommandIds = Object.fromEntries(records
        .filter(record => record.commandType === 'SAVE_INSPECTION')
        .flatMap(record => {
          const value = record.payload as Record<string, unknown>;
          return nonEmptyText(value['examId'])
            ? [[value['examId'], record.idempotencyKey] as const]
            : [];
        }));
      return { route, measurements, finishCommandIds, inspectionCommandIds };
    }));
  }

  validateMeasurement(
    component: QualityExamComponent,
    measuredValue: number,
  ): QualityComponentStatus {
    return measuredValue >= component.minValue && measuredValue <= component.maxValue
      ? 'APPROVED'
      : 'REJECTED';
  }

  validateMeasurementRange(
    component: QualityExamComponent,
    measurement: { minimum: number; maximum: number },
  ): MeasurementValidationResult {
    if (!Number.isFinite(measurement.minimum) || !Number.isFinite(measurement.maximum)) {
      return {
        valid: false,
        reason: 'INVALID_NUMBER',
        message: 'Informe valores numéricos para Min e Max.',
      };
    }

    if (measurement.minimum > measurement.maximum) {
      return {
        valid: false,
        reason: 'INVALID_RANGE',
        message: 'Min deve ser menor ou igual ao Max.',
      };
    }

    if (measurement.minimum < component.minValue || measurement.maximum > component.maxValue) {
      return {
        valid: false,
        reason: 'OUT_OF_RANGE',
        message: 'Valores fora da variação permitida',
      };
    }

    return {
      valid: true,
      status: 'APPROVED',
    };
  }

  saveMeasurement(request: SaveMeasurementRequest): Observable<SaveMeasurementResponse> {
    const savedAt = new Date();
    const nrFicha = request.nrFicha ?? Number(request.routeNumber);
    const codExame = request.examCode;
    const codComponente = request.componentCode;
    if (
      !Number.isSafeInteger(nrFicha) || nrFicha <= 0
      || !Number.isSafeInteger(codExame) || codExame <= 0
      || !Number.isSafeInteger(codComponente) || codComponente <= 0
    ) {
      return throwError(() => new Error('invalid-quality-result-identity'));
    }
    const hasNumericResult = typeof request.measurement.result === 'number'
      && Number.isFinite(request.measurement.result);
    const hasMaximumResult = typeof request.measurement.maximumResult === 'number'
      && Number.isFinite(request.measurement.maximumResult);
    const report = request.measurement.report?.trim() ?? '';
    const option = request.measurement.selectedOption;
    if (hasMaximumResult && !hasNumericResult
      || [hasNumericResult, Boolean(report), Boolean(option)].filter(Boolean).length !== 1) {
      return throwError(() => new Error('invalid-quality-result'));
    }
    return from(this.commands.capture({
      commandType: 'SAVE_QUALITY_RESULT',
      aggregateId: String(nrFicha),
      businessStatus: 'REGISTRADO_LOCALMENTE',
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      occurredAt: savedAt.toISOString(),
      payload: {
        ...(nonEmptyText(request.orderNumber) ? { orderNumber: request.orderNumber.trim() } : {}),
        nrFicha,
        codExame,
        codComponente,
        examId: request.examId,
        componentId: request.componentId,
        ...(hasNumericResult ? { resultado: request.measurement.result! } : {}),
        ...(hasMaximumResult ? { resultadoMax: request.measurement.maximumResult! } : {}),
        ...(report ? { laudo: report } : {}),
        ...(option ? {
          nrTabela: option.tableNumber,
          seqOpcao: option.sequence,
          optionDescription: option.description,
        } : {}),
        observation: request.measurement.observation ?? '',
        operatorId: request.operatorId,
        savedAt: savedAt.toISOString(),
      },
    })).pipe(map(confirmation => ({
      componentId: request.componentId,
      idempotencyKey: confirmation.idempotencyKey,
      measurement: {
        ...request.measurement,
        status: 'RECORDED',
        deliveryStatus: 'PENDING',
        operatorId: request.operatorId,
        savedAt,
        commandId: confirmation.idempotencyKey,
      },
    })));
  }

  watchMeasurementDelivery(idempotencyKey: string): Observable<QualityMeasurementDeliveryUpdate> {
    const ownerId = this.authSession?.currentUser?.id.trim();
    if (!ownerId || !this.outbox || !this.outboxActivity) {
      return of({ deliveryStatus: 'PENDING' });
    }
    return this.outboxActivity.invalidations$.pipe(
      startWith({ type: 'invalidate' as const, version: 0, origin: 'initial' }),
      switchMap(() => from(this.outbox!.getByIdempotencyKey(ownerId, idempotencyKey))),
      map(entry => {
        if (entry?.status === 'SYNCED') {
          const business = entry.receipt?.businessResult;
          const withinRange = business && typeof business === 'object' && !Array.isArray(business)
            && typeof business['dentroFaixa'] === 'boolean'
            ? business['dentroFaixa']
            : undefined;
          return {
            deliveryStatus: 'SYNCED' as const,
            ...(withinRange !== undefined ? { withinRange } : {}),
          };
        }
        if (entry?.status === 'ERROR' || entry?.status === 'BLOCKED_DEPENDENCY') {
          return { deliveryStatus: 'ERROR' as const };
        }
        return { deliveryStatus: 'PENDING' as const };
      }),
    );
  }

  watchFinalizationDelivery(
    idempotencyKey: string,
  ): Observable<QualityRouteFinalizationDeliveryUpdate> {
    const ownerId = this.authSession?.currentUser?.id.trim();
    if (!ownerId || !this.outbox || !this.outboxActivity) {
      return of({ deliveryStatus: 'PENDING' });
    }
    return this.outboxActivity.invalidations$.pipe(
      startWith({ type: 'invalidate' as const, version: 0, origin: 'initial' }),
      switchMap(() => from(this.outbox!.getByIdempotencyKey(ownerId, idempotencyKey))),
      map(entry => {
        if (entry?.status === 'SYNCED') {
          const business = entry.receipt?.businessResult;
          if (!business || typeof business !== 'object' || Array.isArray(business)) {
            return { deliveryStatus: 'ERROR' as const, mensagem: 'Resposta funcional do Datasul indisponível.' };
          }
          return {
            deliveryStatus: 'SYNCED' as const,
            ...(typeof business['finalizado'] === 'boolean' ? { finalizado: business['finalizado'] } : {}),
            ...(typeof business['inspecionado'] === 'boolean' ? { inspecionado: business['inspecionado'] } : {}),
            ...(typeof business['componentesPendentes'] === 'number'
              ? { componentesPendentes: business['componentesPendentes'] }
              : {}),
            ...(typeof business['mensagem'] === 'string' ? { mensagem: business['mensagem'] } : {}),
          };
        }
        if (entry?.status === 'ERROR' || entry?.status === 'BLOCKED_DEPENDENCY') {
          return {
            deliveryStatus: 'ERROR' as const,
            ...(entry.lastError?.userMessage ? { mensagem: entry.lastError.userMessage } : {}),
          };
        }
        return { deliveryStatus: 'PENDING' as const };
      }),
    );
  }

  finishExam(request: {
    examId: string;
    routeNumber: string;
    idempotencyKey?: string;
    dependencyIds?: readonly string[];
  }): Observable<{
    examId: string;
    success: boolean;
    finishedAt: Date;
    idempotencyKey?: string;
  }> {
    const finishedAt = new Date();
    return from(this.commands.capture({
      commandType: 'FINALIZE_QUALITY_ROUTE',
      aggregateId: request.routeNumber,
      businessStatus: 'FINALIZACAO_PENDENTE',
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      occurredAt: finishedAt.toISOString(),
      payload: {
        nrFicha: positiveIntegerFrom(request.routeNumber),
        examId: request.examId,
        finishedAt: finishedAt.toISOString(),
      },
    })).pipe(map(confirmation => ({
      examId: request.examId,
      success: true,
      finishedAt,
      idempotencyKey: confirmation.idempotencyKey,
    })));
  }

  private httpClient(): HttpClient {
    if (!this.http) throw new Error('quality-control-http-not-configured');
    return this.http;
  }

  private authHeaders(): HttpHeaders {
    const token = this.authSession?.token;
    if (!token) throw new Error('quality-control-auth-required');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  stopInspectionRoute(
    request: StopInspectionRouteRequest,
  ): Observable<StopInspectionRouteResponse> {
    const stoppedAt = new Date();
    return from(this.commands.capture({
      commandType: 'STOP_INSPECTION_ROUTE',
      aggregateId: request.routeLocalId ?? request.routeNumber,
      businessStatus: 'PARADO',
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      occurredAt: stoppedAt.toISOString(),
      payload: {
        routeNumber: request.routeNumber,
        examId: request.examId,
        reason: request.reason,
        stoppedAt: stoppedAt.toISOString(),
      },
    })).pipe(map(() => ({ ...request, stoppedAt })));
  }

  authorizeReactionPlan(
    request: ReactionPlanAuthorizationRequest,
  ): Observable<ReactionPlanAuthorization> {
    if (
      !request.localId.trim()
      || !request.supervisorId.trim()
      || !request.password
      || !request.reason.trim()
    ) {
      return throwError(() => new Error('Informe supervisor, senha e motivo da autorização.'));
    }
    if (
      !this.reactionPlanAuthorizer
      || !this.authSession
      || !this.supervisorProofs
      || !this.outbox
    ) {
      return throwError(
        () => new Error('A validação remota do supervisor não está disponível.'),
      );
    }
    const ownerId = this.authSession.currentUser?.id.trim();
    if (!ownerId) {
      return throwError(() => new Error('É necessária uma sessão autenticada.'));
    }
    return from(this.reactionPlanAuthorizer.authorize(request)).pipe(
      switchMap(async result => {
        if (
          !result.supervisorAuthorizationId.trim()
          || !Number.isFinite(result.expiresAt.getTime())
        ) {
          throw new Error('A prova retornada para o supervisor é inválida.');
        }
        this.supervisorProofs!.attach(ownerId, request.localId, result.proof, result.expiresAt);
        const resumed = await this.outbox!.resumeSupervisorBlocked(
          ownerId,
          request.localId,
          new Date().toISOString(),
        );
        if (!resumed) {
          this.supervisorProofs!.clear(ownerId, request.localId);
          throw new Error('O apontamento bloqueado não está mais disponível.');
        }
        this.syncTrigger?.requestSync();
        return {
          componentId: request.componentId,
          supervisorId: request.supervisorId,
          supervisorAuthorizationId: result.supervisorAuthorizationId,
          reason: request.reason.trim(),
          approvedAt: new Date(),
        };
      }),
    );
  }

  saveInspection(payload: SaveInspectionPayload): Observable<SaveInspectionResult> {
    const savedAt = new Date();
    const inspectionId = `INSP-${payload.opNumber}-${payload.examCode}-${payload.routeNumber}`;
    const rejectedMeasurements =
      payload.measurements.filter(measurement => measurement.status === 'REJECTED');
    const requiresSupervisorApproval = rejectedMeasurements.length > 0;
    if (requiresSupervisorApproval && payload.status !== 'REJECTED') {
      throw new Error('Uma inspeção com medição rejeitada não pode ser marcada como aprovada.');
    }
    const hasSupervisorApproval = payload.measurements
      .filter(measurement => measurement.status === 'REJECTED')
      .every(measurement => isValidSupervisorApproval(measurement.supervisorApproval));
    return from(this.commands.capture({
      commandType: 'SAVE_INSPECTION',
      aggregateId: inspectionId,
      businessStatus: payload.status,
      ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
      ...(payload.dependencyIds ? { dependencyIds: payload.dependencyIds } : {}),
      occurredAt: savedAt.toISOString(),
      initialSyncStatus: requiresSupervisorApproval && !hasSupervisorApproval
        ? 'BLOCKED_AUTH'
        : 'PENDING',
      payload: {
        ...payload,
        createdAt: payload.createdAt.toISOString(),
        measurements: payload.measurements.map(measurement => ({ ...measurement })),
      },
    })).pipe(map(confirmation => ({
      inspectionId,
      savedAt,
      idempotencyKey: confirmation.idempotencyKey,
      syncStatus: confirmation.syncStatus,
    })));
  }
}

function isValidSupervisorApproval(
  approval: SaveInspectionPayload['measurements'][number]['supervisorApproval'],
): boolean {
  return Boolean(
    approval
    && approval.supervisorAuthorizationId.trim()
    && approval.reason.trim()
    && !Number.isNaN(Date.parse(approval.approvedAt)),
  );
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function positiveIntegerFrom(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('invalid-quality-route-identity');
  }
  return parsed;
}
