import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

import {
  GenerateInspectionRouteRequest,
  ProductionOrderRoute,
  ProductionOrderRouteRequest,
} from '../models/production-order-route';
import { QualityComponentStatus, QualityExam, QualityExamComponent } from '../models/quality-exam';
import {
  ReactionPlanAuthorization,
  ReactionPlanAuthorizationRequest,
} from '../models/reaction-plan-authorization';
import {
  MeasurementValidationResult,
  RegisterComponentResultRequest,
  RegisterComponentResultResponse,
  SaveMeasurementRequest,
  SaveMeasurementResponse,
  SaveInspectionPayload,
  SaveInspectionResult,
} from '../models/inspection-record';

@Injectable({ providedIn: 'root' })
export class QualityControlService {
  // API facade: keep the UI bound to these contracts while Datasul endpoints are unavailable.
  getProductionOrderRoute(request: ProductionOrderRouteRequest): Observable<ProductionOrderRoute> {
    return of({
      routeNumber: '475.956',
      processDescription: `${request.operationCode} - Extrusao`,
      currentOrder: request.opNumber,
      operationCode: request.operationCode,
      operationDescription: `${request.operationCode} - Extrusao`,
      split: request.split?.trim() || '1',
      itemCode: '61035',
      itemDescription: 'Espacador Cunha 1,5mm',
    });
  }

  generateInspectionRoute(request: GenerateInspectionRouteRequest): Observable<ProductionOrderRoute> {
    return of(request.route);
  }

  getQualityExams(itemCode: string, operationCode: string): Observable<QualityExam[]> {
    return of([
      {
        id: `${itemCode}-${operationCode}-500517`,
        code: '500517',
        description: 'Filmes e Mangueiras',
        version: '1',
        frequency: '2',
        unit: 'pc',
        nqa: '0,000',
        level: '1',
        responsible: 'BUENO',
        components: [
          {
            id: '500517-010',
            code: '010',
            description: 'Cota 488,0 +/- 3,0mm',
            reference: '485 - 491',
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

  validateMeasurement(component: QualityExamComponent, measuredValue: number): QualityComponentStatus {
    return measuredValue >= component.minValue && measuredValue <= component.maxValue ? 'APPROVED' : 'REJECTED';
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
    return of({
      componentId: request.componentId,
      measurement: {
        ...request.measurement,
        operatorId: request.operatorId,
        savedAt: new Date(),
      },
    });
  }

  finishExam(request: { examId: string }): Observable<{ examId: string; success: boolean; finishedAt: Date }> {
    return of({
      examId: request.examId,
      success: true,
      finishedAt: new Date(),
    });
  }

  authorizeReactionPlan(request: ReactionPlanAuthorizationRequest): Observable<ReactionPlanAuthorization> {
    return of({
      componentId: request.componentId,
      supervisorId: request.supervisorId,
      reason: request.reason,
      approvedAt: new Date(),
    });
  }

  registerComponentResult(request: RegisterComponentResultRequest): Observable<RegisterComponentResultResponse> {
    return of({
      componentId: request.componentId,
      status: request.result,
      inspectedAt: new Date(),
      operatorId: request.operatorId,
    });
  }

  saveInspection(payload: SaveInspectionPayload): Observable<SaveInspectionResult> {
    return of({
      inspectionId: `INSP-${payload.opNumber}-${payload.examCode}`,
      savedAt: new Date(),
    });
  }
}
