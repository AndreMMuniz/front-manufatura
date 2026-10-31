import { Injectable, Optional } from '@angular/core';
import { Observable, catchError, defer, from, of, switchMap, throwError } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { ReportDraftPersistence } from '../../../core/offline/services/report-draft-persistence.service';

export interface MotivoRefugo {
  readonly codigo: string;
  readonly descricao: string;
  readonly materialScrap?: boolean;
  readonly rework?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MotivoRefugoService {
  constructor(
    private readonly api: AuthenticatedApiService,
    @Optional() private readonly drafts: ReportDraftPersistence | null = null,
  ) {}

  buscarMotivos(termo: string): Observable<ReadonlyArray<MotivoRefugo>> {
    const term = termo.trim();
    return defer(() => this.api.get<ReadonlyArray<MotivoRefugo>>('/api/scrap-reasons', {
      term: term || undefined,
    })).pipe(
      switchMap(motivos => this.drafts && !term
        ? from(this.drafts.write('report-reasons-catalog', { motivos })).pipe(switchMap(() => of(motivos)))
        : of(motivos)),
      catchError(error => this.drafts
        ? from(this.drafts.read<{ motivos: ReadonlyArray<MotivoRefugo> }>('report-reasons-catalog')).pipe(
            switchMap(cached => cached && Array.isArray(cached.motivos) && cached.motivos.every(motivo => motivo
              && typeof motivo.codigo === 'string' && typeof motivo.descricao === 'string'
              && typeof motivo.materialScrap === 'boolean' && typeof motivo.rework === 'boolean')
              ? of(cached.motivos.filter(motivo => !term || `${motivo.codigo} ${motivo.descricao}`.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'))))
              : throwError(() => error)),
          )
        : throwError(() => error)),
    );
  }
}
