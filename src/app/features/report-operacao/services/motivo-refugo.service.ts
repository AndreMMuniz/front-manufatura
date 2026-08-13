import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';

export interface MotivoRefugo {
  readonly codigo: string;
  readonly descricao: string;
}

@Injectable({ providedIn: 'root' })
export class MotivoRefugoService {
  constructor(private readonly api: AuthenticatedApiService) {}

  buscarMotivos(termo: string): Observable<ReadonlyArray<MotivoRefugo>> {
    return this.api.get<ReadonlyArray<MotivoRefugo>>('/api/scrap-reasons', {
      term: termo.trim() || undefined,
    });
  }
}
