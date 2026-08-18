import { Injectable } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import {
  mapAuthorizedComponentResultEnvelope,
  mapAuthorizedFinalizationEnvelope,
  mapPendingRoutesEnvelope,
} from '../mappers/route-authorization.mapper';
import {
  AuthorizedComponentResultRequest,
  AuthorizedComponentSaveResult,
  AuthorizedRouteFinalizationOutcome,
  PendingAuthorizedRoute,
} from '../models/route-authorization.model';
import { mapInspectionRouteEnvelopeForSheet } from '../../quality-control/mappers/datasul-quality-control.mapper';
import { ProductionOrderRoute } from '../../quality-control/models/production-order-route';
import { QualityExam } from '../../quality-control/models/quality-exam';

@Injectable({ providedIn: 'root' })
export class RouteAuthorizationService {
  constructor(private readonly api: AuthenticatedApiService) {}

  search(orderNumber: number, operationCode: number): Observable<PendingAuthorizedRoute[]> {
    if (!positiveInteger(orderNumber) || !positiveInteger(operationCode)) {
      return throwError(() => new Error('invalid-route-authorization-query'));
    }
    return this.api.get<unknown>('/api/quality-control/route-authorizations', {
      nrOrdemProducao: orderNumber,
      opCodigo: operationCode,
    }).pipe(map(mapPendingRoutesEnvelope));
  }

  loadRoute(
    route: PendingAuthorizedRoute,
    operationCode: number,
  ): Observable<{ readonly route: ProductionOrderRoute; readonly exams: QualityExam[] }> {
    if (!positiveInteger(route.sheetNumber)
      || !positiveInteger(route.productionOrderNumber)
      || !positiveInteger(operationCode)) {
      return throwError(() => new Error('invalid-route-authorization-route'));
    }
    return this.api.post<unknown>(
      '/api/quality-control/route-authorizations/route',
      {
        nrFicha: route.sheetNumber,
        nrOrdemProducao: route.productionOrderNumber,
        codOperacao: operationCode,
      },
    ).pipe(map(value => mapInspectionRouteEnvelopeForSheet(value, {
      orderNumber: String(route.productionOrderNumber),
      operation: {
        operationCode: String(operationCode),
        operationDescription: route.narrative,
        processDescription: route.narrative,
        split: String(route.operationSequence),
        itemCode: route.itemCode,
        itemDescription: route.itemDescription,
      },
    }, route.sheetNumber)));
  }

  saveComponent(
    sheetNumber: number,
    examCode: number,
    componentCode: number,
    request: AuthorizedComponentResultRequest,
  ): Observable<AuthorizedComponentSaveResult> {
    if (![sheetNumber, examCode, componentCode].every(positiveInteger)) {
      return throwError(() => new Error('invalid-route-authorization-component'));
    }
    const result = resultPayloadOf(request);
    if (!result) return throwError(() => new Error('invalid-route-authorization-result'));
    return this.api.put<unknown>(
      '/api/quality-control/route-authorizations/results',
      { nrFicha: sheetNumber, codExame: examCode, codComponente: componentCode, ...result },
    ).pipe(map(value => mapAuthorizedComponentResultEnvelope(
      value,
      sheetNumber,
      examCode,
      componentCode,
    )));
  }

  finalize(sheetNumber: number): Observable<AuthorizedRouteFinalizationOutcome> {
    if (!positiveInteger(sheetNumber)) {
      return throwError(() => new Error('invalid-route-authorization-sheet'));
    }
    return this.api.post<unknown>(
      '/api/quality-control/route-authorizations/finalize',
      { nrFicha: sheetNumber },
    ).pipe(map(value => mapAuthorizedFinalizationEnvelope(value, sheetNumber)));
  }
}

function resultPayloadOf(
  request: AuthorizedComponentResultRequest,
): { readonly resultado: number } | { readonly nrTabela: number; readonly seqOpcao: number } | { readonly laudo: string } | null {
  if (request.kind === 'numeric') {
    return Number.isFinite(request.result) ? { resultado: request.result } : null;
  }
  if (request.kind === 'table') {
    return positiveInteger(request.tableNumber) && positiveInteger(request.optionSequence)
      ? { nrTabela: request.tableNumber, seqOpcao: request.optionSequence }
      : null;
  }
  return request.report.trim() ? { laudo: request.report } : null;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
