import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of } from 'rxjs';

import { EquipesService } from '../../equipes/services/equipes.service';
import { ResponsavelOperacional } from '../models/operational-responsible';
import { AreaProducao } from '../models/production-area';
import { WorkCenter } from '../models/work-center';
import { WorkCenterService } from './work-center';

const AREAS: ReadonlyArray<AreaProducao> = Object.freeze([
  { code: '4001', description: 'Produção' },
  { code: '4002', description: 'Qualidade' },
]);

@Injectable({ providedIn: 'root' })
export class ProductionContextCatalogService {
  private readonly workCenters = inject(WorkCenterService);
  private readonly equipes = inject(EquipesService);

  listarAreas(): Observable<ReadonlyArray<AreaProducao>> {
    return of(AREAS.map(area => ({ ...area })));
  }

  pesquisarCentros(areaCode: string, termo = ''): Observable<ReadonlyArray<WorkCenter>> {
    const area = this.normalizeCode(areaCode);
    if (!AREAS.some(item => this.normalizeCode(item.code) === area)) {
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

    return forkJoin({
      operadores: this.equipes.listarOperadores(),
      equipes: this.equipes.listarEquipesElegiveis(area, center),
    }).pipe(
      map(({ operadores, equipes }) => {
        const eligibleOperatorCodes = area === '4001' && center === 'CT-EXT-01'
          ? new Set(['OP-001', '001', '002', '003'])
          : new Set<string>();
        const unique = new Map<string, ResponsavelOperacional>();

        for (const operador of operadores) {
          const codigo = this.normalizeCode(operador.codigo);
          if (eligibleOperatorCodes.has(codigo)) {
            unique.set(`OPERADOR|${codigo}`, {
              tipo: 'OPERADOR',
              codigo,
              nome: operador.nome,
            });
          }
        }
        for (const equipe of equipes) {
          const codigo = this.normalizeCode(equipe.codigo);
          unique.set(`EQUIPE|${codigo}`, {
            tipo: 'EQUIPE',
            codigo,
            nome: equipe.descricao,
          });
        }

        return [...unique.values()].map(responsavel => ({ ...responsavel }));
      }),
    );
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }
}
