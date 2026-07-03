import { Injectable } from '@angular/core';

export interface RefugoItem {
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
}

@Injectable({ providedIn: 'root' })
export class RefugoService {
  calcularTotal(itens: ReadonlyArray<RefugoItem>): number {
    return itens.reduce((total, item) => total + item.quantidade, 0);
  }

  consolidarItens(itens: ReadonlyArray<RefugoItem>): ReadonlyArray<RefugoItem> {
    const itensPorCodigo = new Map<string, RefugoItem>();

    for (const item of itens) {
      const existente = itensPorCodigo.get(item.codigo);
      itensPorCodigo.set(
        item.codigo,
        existente ? { ...existente, quantidade: existente.quantidade + item.quantidade } : { ...item },
      );
    }

    return Array.from(itensPorCodigo.values());
  }
}
