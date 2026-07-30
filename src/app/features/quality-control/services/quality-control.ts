import { Inject, Injectable, InjectionToken, Optional } from '@angular/core';
import { Observable, from, map, of, switchMap, throwError } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { SupervisorProofVault } from '../../../core/offline/services/supervisor-proof-vault';
import { SyncTriggerService } from '../../../core/offline/services/sync-trigger.service';

import {
  GenerateInspectionRouteRequest,
  ProductionOrderOperationsResult,
  ProductionOrderRoute,
} from '../models/production-order-route';
import { QualityComponentStatus, QualityExam, QualityExamComponent } from '../models/quality-exam';
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
  ) {}

  // API facade: keep the UI bound to these contracts while Datasul endpoints are unavailable.
  getProductionOrderOperations(orderNumber: string): Observable<ProductionOrderOperationsResult> {
    return of({
      orderNumber,
      operations: [
        {
          operationCode: '10',
          operationDescription: 'Cortar chapa',
          split: '1',
          itemCode: '30907',
          itemDescription: 'Alavanca Master 75 OP10',
          processDescription: 'Corte de chapa',
        },
        {
          operationCode: '20',
          operationDescription: 'Dobrar chapa',
          split: '1',
          itemCode: '30907',
          itemDescription: 'Alavanca Master 75 OP10',
          processDescription: 'Dobra de chapa',
        },
        {
          operationCode: '30',
          operationDescription: 'Soldar',
          split: '1',
          itemCode: '30907',
          itemDescription: 'Alavanca Master 75 OP10',
          processDescription: 'Soldagem',
        },
      ],
    });
  }

  generateInspectionRoute(
    request: GenerateInspectionRouteRequest,
  ): Observable<ProductionOrderRoute> {
    const aggregateId =
      request.idempotencyKey
      ?? `${request.orderNumber}-${request.operation.operationCode}-${request.operation.split?.trim() || '1'}`;
    const routeNumber = '475.956';
    const occurredAt = new Date().toISOString();
    return from(this.commands.capture({
      commandType: 'GENERATE_INSPECTION_ROUTE',
      aggregateId,
      businessStatus: 'GERADO',
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      occurredAt,
      payload: {
        orderNumber: request.orderNumber,
        operationCode: request.operation.operationCode,
        split: request.operation.split?.trim() || '1',
        itemCode: request.operation.itemCode,
        itemDescription: request.operation.itemDescription,
        moveBalance: request.moveBalance,
        generatedAt: occurredAt,
      },
    })).pipe(map(confirmation => ({
      localId: confirmation.localId,
      creationCommandId: confirmation.idempotencyKey,
      routeNumber,
      processDescription: request.operation.processDescription,
      currentOrder: request.orderNumber,
      operationCode: request.operation.operationCode,
      operationDescription: `${request.operation.operationCode} - ${request.operation.operationDescription}`,
      split: request.operation.split?.trim() || '1',
      itemCode: request.operation.itemCode,
      itemDescription: request.operation.itemDescription,
    })));
  }

  getQualityExams(itemCode: string, operationCode: string): Observable<QualityExam[]> {
    return of([
      {
        id: `${itemCode}-${operationCode}-500517`,
        code: '500517',
        description: 'Filmes e Mangueiras',
        version: '1',
        frequency: '2',
        sample: '1 pc',
        unit: 'pc',
        nqa: '0,000',
        level: '1',
        responsible: 'BUENO',
        observation: 'Visual 100% do corte !',
        components: [
          {
            id: '500517-010',
            code: '010',
            description: 'Cota 488,0 +/- 3,0mm',
            reference: '485 - 491',
            measurementMethod: 'Régua',
            minValue: 485,
            maxValue: 491,
            unit: 'mm',
            sequence: 10,
            status: 'PENDING',
          },
          {
            id: '500517-020',
            code: '020',
            description: 'Cota 255,0 +/- 0,5mm',
            reference: '254,5 - 255,5',
            measurementMethod: 'Paquímetro',
            minValue: 254.5,
            maxValue: 255.5,
            unit: 'mm',
            sequence: 20,
            status: 'PENDING',
          },
          {
            id: '500517-030',
            code: '030',
            description: 'Cota 380,0 +/- 5,0mm',
            reference: '375 - 385',
            measurementMethod: 'Régua',
            minValue: 375,
            maxValue: 385,
            unit: 'mm',
            sequence: 30,
            status: 'PENDING',
          },
        ],
      },
    ]);
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
    return from(this.commands.capture({
      commandType: 'SAVE_MEASUREMENT',
      aggregateId: request.examId,
      businessStatus: request.measurement.status,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      occurredAt: savedAt.toISOString(),
      payload: {
        routeNumber: request.routeNumber ?? '',
        examId: request.examId,
        componentId: request.componentId,
        minimum: request.measurement.minimum,
        maximum: request.measurement.maximum,
        observation: request.measurement.observation ?? '',
        status: request.measurement.status,
        operatorId: request.operatorId,
        savedAt: savedAt.toISOString(),
      },
    })).pipe(map(confirmation => ({
      componentId: request.componentId,
      idempotencyKey: confirmation.idempotencyKey,
      measurement: {
        ...request.measurement,
        operatorId: request.operatorId,
        savedAt,
        commandId: confirmation.idempotencyKey,
      },
    })));
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
    idempotencyKey: string;
  }> {
    const finishedAt = new Date();
    return from(this.commands.capture({
      commandType: 'FINISH_EXAM',
      aggregateId: request.routeNumber,
      businessStatus: 'FINALIZADO',
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      occurredAt: finishedAt.toISOString(),
      payload: { examId: request.examId, finishedAt: finishedAt.toISOString() },
    })).pipe(map(confirmation => ({
      examId: request.examId,
      success: true,
      finishedAt,
      idempotencyKey: confirmation.idempotencyKey,
    })));
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
