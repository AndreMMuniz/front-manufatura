import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { ResponsavelOperacional } from '../models/operational-responsible';
import { AreaProducao } from '../models/production-area';
import { WorkCenter } from '../models/work-center';
import { WorkCenterService } from './work-center';

@Injectable({ providedIn: 'root' })
export class ProductionContextCatalogService {
  private readonly workCenters = inject(WorkCenterService);
  private readonly api = inject(AuthenticatedApiService);

  listarAreas(): Observable<ReadonlyArray<AreaProducao>> {
    return this.api.get<ReadonlyArray<AreaProducao>>('/api/production-areas').pipe(
      map(areas => areas.map(area => ({ ...area }))),
    );
  }

  pesquisarCentros(areaCode: string, termo = ''): Observable<ReadonlyArray<WorkCenter>> {
    const area = this.normalizeCode(areaCode);
    if (!area) {
      return of([]);
    }

    return this.workCenters.searchActiveWorkCenters(area, termo).pipe(
      map(centers => centers.map(center => ({ ...center }))),
    );
  }

  listarResponsaveis(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<ResponsavelOperacional>> {
    const area = this.normalizeCode(areaCode);
    const center = this.normalizeCode(workCenterCode);
    if (!area || !center) {
      return of([]);
    }

    return this.api.get<ReadonlyArray<ResponsavelOperacional>>(
      '/api/operational-responsibles',
      { areaCode: area, workCenterCode: center },
    ).pipe(
      map(responsaveis => responsaveis.map(responsavel => ({
        ...responsavel,
        codigo: this.normalizeCode(responsavel.codigo),
      }))),
    );
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }
}
