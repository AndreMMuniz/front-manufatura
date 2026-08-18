import { Injectable } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import {
  mapAuthorizedFinalizationEnvelope,
  mapPendingRoutesEnvelope,
} from '../mappers/route-authorization.mapper';
import {
  AuthorizedRouteFinalization,
  PendingAuthorizedRoute,
} from '../models/route-authorization.model';

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

  finalize(sheetNumber: number): Observable<AuthorizedRouteFinalization> {
    if (!positiveInteger(sheetNumber)) {
      return throwError(() => new Error('invalid-route-authorization-sheet'));
    }
    return this.api.post<unknown>(
      '/api/quality-control/route-authorizations/finalize',
      { nrFicha: sheetNumber },
    ).pipe(map(value => mapAuthorizedFinalizationEnvelope(value, sheetNumber)));
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
