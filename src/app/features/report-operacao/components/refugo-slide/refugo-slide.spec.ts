import { Subject, of, throwError } from 'rxjs';
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

  it('emits an empty composition when saving a zero total without partial input', () => {
    const component = createComponent();
    const emit = vi.spyOn(component.refugoRegistrado, 'emit');

    component.abrir(0, []);
    component.salvar();

    expect(emit).toHaveBeenCalledWith({
      quantidade: 0,
      motivo: '',
      itens: [],
    });
  });

  it('blocks save and explains the problem when the form has partial input', () => {
    const component = createComponent();
    const emit = vi.spyOn(component.refugoRegistrado, 'emit');

    component.abrir(0, []);
    component.motivoCodigo = '05';
    component.salvar();

    expect(emit).not.toHaveBeenCalled();
    expect(component.validationMessage).toBe('Informe uma quantidade maior que zero.');
  });

  it('loads scrap reasons through the service and preserves items when the search fails', () => {
    const motivoService = {
      buscarMotivos: vi.fn(() => throwError(() => new Error('API indisponivel'))),
    };
    const { component } = createComponentWithMocks({ motivoService });
    const itens: ReadonlyArray<RefugoRegistradoItem> = [{ codigo: '05', descricao: 'Borra', quantidade: 0.55 }];

    component.abrir(0, itens);

    expect(component.itens).toEqual(itens);
    expect(component.estado).toBe('erro');
    expect(component.motivoErrorMessage).toBe('Não foi possível carregar os motivos de refugo. Tente novamente.');
  });

  it('temporarily blocks add while searching scrap reasons', () => {
    const search = new Subject<ReadonlyArray<{ codigo: string; descricao: string }>>();
    const motivoService = {
      buscarMotivos: vi.fn(() => search.asObservable()),
    };
    const { component } = createComponentWithMocks({ motivoService });

    component.buscarMotivos('bo');
    component.motivoCodigo = '05';
    component.quantidade = 0.55;

    expect(component.estado).toBe('pesquisando');
    expect(component.canAdicionar).toBe(false);

    search.next([{ codigo: '05', descricao: 'Borra' }]);
    search.complete();

    expect(component.estado).toBe('motivo-selecionado');
    expect(component.canAdicionar).toBe(true);
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

  function createComponentWithMocks(overrides: {
    motivoService?: { buscarMotivos: ReturnType<typeof vi.fn> };
    refugoService?: {
      calcularTotal: (items: ReadonlyArray<RefugoRegistradoItem>) => number;
      consolidarItens: (items: ReadonlyArray<RefugoRegistradoItem>) => ReadonlyArray<RefugoRegistradoItem>;
    };
  } = {}): {
    component: RefugoSlide;
    dialog: { confirm: ReturnType<typeof vi.fn> };
    pageSlide: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  } {
    const dialog = { confirm: vi.fn() };
    const changeDetector = { markForCheck: vi.fn() };
    const pageSlide = { open: vi.fn(), close: vi.fn() };
    const motivoService = overrides.motivoService ?? { buscarMotivos: vi.fn(() => of([])) };
    const refugoService = overrides.refugoService ?? {
      calcularTotal: (items: ReadonlyArray<RefugoRegistradoItem>) =>
        items.reduce((total, item) => total + item.quantidade, 0),
      consolidarItens: (items: ReadonlyArray<RefugoRegistradoItem>) => {
        const byCode = new Map<string, RefugoRegistradoItem>();
        for (const item of items) {
          const existing = byCode.get(item.codigo);
          byCode.set(
            item.codigo,
            existing ? { ...existing, quantidade: existing.quantidade + item.quantidade } : item,
          );
        }
        return Array.from(byCode.values());
      },
    };
    const component = new RefugoSlide(
      changeDetector as never,
      dialog as never,
      motivoService as never,
      refugoService as never,
    );
    component.motivos = [
      { codigo: '05', descricao: 'Borra' },
      { codigo: '32', descricao: 'Varredura' },
      { codigo: '35', descricao: 'Setup' },
    ];
    component.motivoOptions = component.motivos.map(item => ({
      label: `${item.codigo} - ${item.descricao}`,
      value: item.codigo,
    }));
    Object.defineProperty(component, 'pageSlide', { value: pageSlide });

    return { component, dialog, pageSlide };
  }
});
