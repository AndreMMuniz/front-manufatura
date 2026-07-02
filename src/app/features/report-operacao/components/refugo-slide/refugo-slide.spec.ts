import { describe, expect, it, vi } from 'vitest';

import { RefugoSlide, RefugoRegistradoItem } from './refugo-slide';

describe('RefugoSlide', () => {
  it('blocks empty reasons and non-positive quantities before adding', () => {
    const component = createComponent();

    component.quantidade = 1;
    component.adicionarRefugo();
    expect(component.itens).toEqual([]);

    component.motivoCodigo = '05';
    component.quantidade = 0;
    component.adicionarRefugo();
    expect(component.itens).toEqual([]);

    component.quantidade = -1;
    component.adicionarRefugo();
    expect(component.itens).toEqual([]);
  });

  it('adds multiple scrap reasons and calculates the consolidated total', () => {
    const component = createComponent();

    component.motivoCodigo = '05';
    component.quantidade = 0.55;
    component.adicionarRefugo();
    component.motivoCodigo = '32';
    component.quantidade = 1.5;
    component.adicionarRefugo();

    expect(component.itens).toEqual([
      { codigo: '05', descricao: 'Borra', quantidade: 0.55 },
      { codigo: '32', descricao: 'Varredura', quantidade: 1.5 },
    ]);
    expect(component.totalRefugo).toBeCloseTo(2.05);
  });

  it('emits the consolidated list when saving', () => {
    const component = createComponent();
    const emit = vi.spyOn(component.refugoRegistrado, 'emit');

    component.motivoCodigo = '05';
    component.quantidade = 0.55;
    component.adicionarRefugo();
    component.salvar();

    expect(emit).toHaveBeenCalledWith({
      quantidade: 0.55,
      motivo: '05 - Borra',
      itens: [{ codigo: '05', descricao: 'Borra', quantidade: 0.55 }],
    });
  });

  it('restores existing scrap items when reopened for the same operation', () => {
    const component = createComponent();
    const itens: ReadonlyArray<RefugoRegistradoItem> = [
      { codigo: '05', descricao: 'Borra', quantidade: 0.55 },
      { codigo: '35', descricao: 'Setup', quantidade: 2.5 },
    ];

    component.abrir(3.05, itens);

    expect(component.itens).toEqual(itens);
    expect(component.totalRefugo).toBeCloseTo(3.05);
  });

  function createComponent(): RefugoSlide {
    const component = new RefugoSlide();
    Object.defineProperty(component, 'pageSlide', {
      value: { open: vi.fn(), close: vi.fn() },
    });

    return component;
  }
});
