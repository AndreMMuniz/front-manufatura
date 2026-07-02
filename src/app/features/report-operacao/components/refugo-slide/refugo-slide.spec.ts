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

  it('consolidates repeated scrap reasons into a single row', () => {
    const component = createComponent();

    component.motivoCodigo = '05';
    component.quantidade = 0.55;
    component.adicionarRefugo();
    component.motivoCodigo = '05';
    component.quantidade = 1.25;
    component.adicionarRefugo();

    expect(component.itens).toEqual([{ codigo: '05', descricao: 'Borra', quantidade: 1.8 }]);
    expect(component.totalRefugo).toBeCloseTo(1.8);
  });

  it('removes a scrap item so the operator can correct mistakes before saving', () => {
    const component = createComponent();

    component.motivoCodigo = '05';
    component.quantidade = 0.55;
    component.adicionarRefugo();
    component.motivoCodigo = '32';
    component.quantidade = 1.5;
    component.adicionarRefugo();
    component.removerRefugo(0);

    expect(component.itens).toEqual([{ codigo: '32', descricao: 'Varredura', quantidade: 1.5 }]);
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

  it('preserves a legacy scrap quantity when opened without item composition', () => {
    const component = createComponent();

    component.abrir(2.5, []);

    expect(component.itens).toEqual([{ codigo: '00', descricao: 'Refugo informado anteriormente', quantidade: 2.5 }]);
  });

  it('confirms before discarding unsaved changes on back', () => {
    const { component, dialog, pageSlide } = createComponentWithMocks();

    component.abrir(0, []);
    component.motivoCodigo = '05';
    component.quantidade = 0.55;
    component.adicionarRefugo();
    component.voltar();

    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Descartar alterações?',
        confirm: expect.any(Function),
      }),
    );

    const confirm = vi.mocked(dialog.confirm).mock.calls[0][0].confirm;
    confirm?.();
    expect(pageSlide.close).toHaveBeenCalled();
  });

  it('emits global exit when sair is confirmed', () => {
    const { component, dialog } = createComponentWithMocks();
    const emit = vi.spyOn(component.sairSolicitado, 'emit');

    component.abrir(0, []);
    component.motivoCodigo = '05';
    component.sair();

    const confirm = vi.mocked(dialog.confirm).mock.calls[0][0].confirm;
    confirm?.();

    expect(emit).toHaveBeenCalled();
  });

  it('formats quantities with the expected local decimal separator', () => {
    const component = createComponent();

    expect(component.formatQuantidade(0.55)).toBe('0,550');
  });

  function createComponent(): RefugoSlide {
    return createComponentWithMocks().component;
  }

  function createComponentWithMocks(): {
    component: RefugoSlide;
    dialog: { confirm: ReturnType<typeof vi.fn> };
    pageSlide: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  } {
    const dialog = { confirm: vi.fn() };
    const changeDetector = { markForCheck: vi.fn() };
    const pageSlide = { open: vi.fn(), close: vi.fn() };
    const component = new RefugoSlide(changeDetector as never, dialog as never);
    Object.defineProperty(component, 'pageSlide', { value: pageSlide });

    return { component, dialog, pageSlide };
  }
});
