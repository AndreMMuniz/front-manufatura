import { describe, expect, it } from 'vitest';

import { RefugoService } from './refugo.service';

describe('RefugoService', () => {
  const service = new RefugoService();

  it('calculates the total and consolidates repeated scrap reasons', () => {
    const itens = [
      { codigo: '05', descricao: 'Borra', quantidade: 0.5 },
      { codigo: '32', descricao: 'Varredura', quantidade: 1.5 },
      { codigo: '05', descricao: 'Borra', quantidade: 0.25 },
    ];

    expect(service.calcularTotal(itens)).toBeCloseTo(2.25);
    expect(service.consolidarItens(itens)).toEqual([
      { codigo: '05', descricao: 'Borra', quantidade: 0.75 },
      { codigo: '32', descricao: 'Varredura', quantidade: 1.5 },
    ]);
  });
});
