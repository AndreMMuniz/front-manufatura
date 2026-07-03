import { Injectable } from '@angular/core';

import { Observable, of } from 'rxjs';

export interface MotivoRefugo {
  readonly codigo: string;
  readonly descricao: string;
}

export const MOTIVOS_REFUGO_MOCK: ReadonlyArray<MotivoRefugo> = [
  { codigo: '05', descricao: 'Borra' },
  { codigo: '32', descricao: 'Varredura' },
  { codigo: '35', descricao: 'Setup' },
  { codigo: '18', descricao: 'Quebra' },
  { codigo: '41', descricao: 'Setup de maquina' },
];

@Injectable({ providedIn: 'root' })
export class MotivoRefugoService {
  buscarMotivos(termo: string): Observable<ReadonlyArray<MotivoRefugo>> {
    const normalizedTerm = this.normalize(termo);

    if (!normalizedTerm) {
      return of(MOTIVOS_REFUGO_MOCK);
    }

    return of(
      MOTIVOS_REFUGO_MOCK.filter(
        motivo =>
          this.normalize(motivo.codigo).includes(normalizedTerm) ||
          this.normalize(motivo.descricao).includes(normalizedTerm),
      ),
    );
  }

  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');
  }
}
