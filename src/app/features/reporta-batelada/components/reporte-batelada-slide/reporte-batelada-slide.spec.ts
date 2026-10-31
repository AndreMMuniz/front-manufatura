import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { PoDialogService, PoPageSlideComponent } from '@po-ui/ng-components';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MotivoRefugoService } from '../../../report-operacao/services/motivo-refugo.service';
import { OrdemLiberadaBatelada, ReporteParcialBatelada } from '../../models/reporta-batelada.model';

import { ReporteBateladaSlide } from './reporte-batelada-slide';

describe('ReporteBateladaSlide', () => {
  it('waits for asynchronous options before mounting PO selects for a restored batch draft', async () => {
    const catalog = new Subject<ReadonlyArray<{ codigo: string; descricao: string; materialScrap: boolean; rework: boolean }>>();
    await TestBed.configureTestingModule({ imports: [ReporteBateladaSlide], providers: [provideNoopAnimations(), { provide: PoDialogService, useValue: { confirm: vi.fn() } }, { provide: MotivoRefugoService, useValue: { buscarMotivos: () => catalog } }] }).compileComponents();
    const fixture = TestBed.createComponent(ReporteBateladaSlide);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrir(orders(), [], { schemaVersion: 2, idempotencyKey: null, items: orders().map((order, index) => ({ schemaVersion: 2, orderId: order.id, ordem: order.ordem, quantidadeAprovada: 0, quantidadeRetrabalho: index === 0 ? 5 : 0, quantidadeRefugo: index === 0 ? 2 : 0, refugoItens: [], motivos: index === 0 ? [{ codigo: '18', descricao: 'Retrabalho', quantidadeRetrabalho: 5, quantidadeRefugo: 0 }, { codigo: '05', descricao: 'Borra', quantidadeRetrabalho: 0, quantidadeRefugo: 2 }] : [] })) });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.report-reasons po-select')).toHaveLength(0);
    catalog.next([{ codigo: '18', descricao: 'Retrabalho', rework: true, materialScrap: false }, { codigo: '05', descricao: 'Borra', rework: false, materialScrap: true }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.motivoSelecionado(component.items[0], 'retrabalho')).toBe('18');
    expect(component.motivoSelecionado(component.items[0])).toBe('05');
    expect(fixture.nativeElement.querySelector('select[name="motivo-retrabalho-2"]')?.value).toBe('18');
    expect(fixture.nativeElement.querySelector('select[name="motivo-refugo-2"]')?.value).toBe('05');
  });
  it('keeps a safe empty draft when persisted data is corrupt', async () => {
    const { component } = createComponent();
    component.draftPersistence = { read: async () => ({ schemaVersion: 2, items: [null] }) } as never;
    component.draftIdentity = 'batch';
    component.abrir(orders(), [], null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.validationMessage).toContain('inválido');
    expect(component.restoringDraft).toBe(false);
    expect(component.hasDraft).toBe(false);
  });

  it('does not let a stale restore unlock a newer context', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { component } = createComponent();
    component.draftPersistence = { read: () => new Promise(resolve => pending.push(resolve)) } as never;
    component.draftIdentity = 'first';
    component.abrir(orders(), [], null);
    component.draftIdentity = 'second';
    component.abrir(orders(), [], null);
    pending[0](null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.restoringDraft).toBe(true);
    pending[1](null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.restoringDraft).toBe(false);
  });
  it('restores a persisted v2 draft after reconstruction without sharing selections across orders', async () => {
    let saved: unknown = null;
    const store = { read: async () => saved, write: async (_identity: string, data: unknown) => { saved = data === null ? null : JSON.parse(JSON.stringify(data)); return true; } };
    const first = createComponent().component;
    first.draftPersistence = store as never;
    first.draftIdentity = 'area|ct|batch';
    first.abrir(orders(), [], null);
    await new Promise(resolve => setTimeout(resolve, 0));
    first.atualizarQuantidade('2', 'quantidadeRetrabalho', 5);
    first.atualizarQuantidade('2', 'quantidadeRefugo', 2);
    first.atualizarMotivo('2', '18', 'retrabalho');
    first.atualizarMotivo('2', '05');
    await new Promise(resolve => setTimeout(resolve, 0));
    const second = createComponent().component;
    second.draftPersistence = store as never;
    second.draftIdentity = 'area|ct|batch';
    second.abrir(orders(), [], null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(second.motivoSelecionado(second.items[0], 'retrabalho')).toBe('18');
    expect(second.motivoSelecionado(second.items[0])).toBe('05');
    expect(second.items[1].motivos).toEqual([]);
    expect(second.canSave).toBe(true);
    second.confirmarReporte(report());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(saved).toBeNull();
  });

  it('keeps legacy reasons visible in the draft until explicitly reviewed', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], { idempotencyKey: 'old', items: report().items });
    expect(component.items[0].legacyReasons).toEqual(report().items[0].refugoItens);
    const draft = vi.spyOn(component.rascunhoAlterado, 'emit');
    component.atualizarQuantidade('1', 'quantidadeAprovada', 10);
    expect(draft.mock.calls[0][0].items[0].legacyReasons).toEqual(report().items[0].refugoItens);
    expect(component.items[0].motivos).toEqual([]);
  });
  it('preserves independent reasons through failure, zeroing and draft restoration', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRetrabalho', 5);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 2);
    component.atualizarMotivo('2', '18', 'retrabalho');
    component.atualizarMotivo('2', '05');
    const emitted = vi.spyOn(component.reporteSolicitado, 'emit');
    component.salvar();
    const draft = emitted.mock.calls[0][0];
    expect(draft.schemaVersion).toBe(2);
    expect(draft.items[0].motivos).toEqual([
      { codigo: '18', descricao: 'Quebra', quantidadeRetrabalho: 5, quantidadeRefugo: 0 },
      { codigo: '05', descricao: 'Borra', quantidadeRetrabalho: 0, quantidadeRefugo: 2 },
    ]);
    component.informarErro('Falha remota');
    component.atualizarQuantidade('2', 'quantidadeRefugo', 0);
    expect(component.motivoSelecionado(component.items[0], 'retrabalho')).toBe('18');
    expect(component.motivoSelecionado(component.items[0])).toBe('');
    const restored = createComponent().component;
    restored.abrir(orders(), [], draft);
    expect(restored.canSave).toBe(true);
    expect(restored.items[0].motivos).not.toBe(draft.items[0].motivos);
    expect(restored.items[1].motivos).toEqual([]);
  });
  it('does not reuse a legacy draft key or infer two independent reasons', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], { idempotencyKey: 'old-key', items: report().items });
    expect(component.canSave).toBe(false);
    expect(component.items[0].motivos).toEqual([]);
    expect(component.validationMessage).toContain('legado');
    component.atualizarMotivo('2', '05');
    const emitted = vi.spyOn(component.reporteSolicitado, 'emit');
    component.salvar();
    expect(emitted.mock.calls[0][0].idempotencyKey).not.toBe('old-key');
  });
  it('uses the same small drawer size as the order report', () => {
    TestBed.configureTestingModule({
      imports: [ReporteBateladaSlide],
      providers: [
        provideNoopAnimations(),
        { provide: PoDialogService, useValue: { confirm: vi.fn() } },
        { provide: MotivoRefugoService, useValue: { buscarMotivos: () => of([]) } },
      ],
    });
    const fixture = TestBed.createComponent(ReporteBateladaSlide);
    fixture.detectChanges();

    const pageSlide = fixture.debugElement.query(By.directive(PoPageSlideComponent))
      .componentInstance as PoPageSlideComponent;

    expect(pageSlide.size).toBe('sm');
  });

  it('sums only approved and scrap quantities in the displayed total', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', 100);
    component.atualizarQuantidade('2', 'quantidadeRetrabalho', 2);
    component.atualizarQuantidade('1', 'quantidadeRefugo', 10);

    expect(component.totalInformado).toBe(110);
  });

  it('requires a rework reason for a batch containing only rework', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRetrabalho', 2);

    expect(component.totalInformado).toBe(0);
    expect(component.canSave).toBe(false);
    component.atualizarMotivo('2', '05', 'retrabalho');
    expect(component.canSave).toBe(true);
  });

  it('renders the same quantity labels as the order report and the ordered history columns in the DOM', () => {
    TestBed.configureTestingModule({
      imports: [ReporteBateladaSlide],
      providers: [
        provideNoopAnimations(),
        { provide: PoDialogService, useValue: { confirm: vi.fn() } },
        { provide: MotivoRefugoService, useValue: { buscarMotivos: () => of([]) } },
      ],
    });
    const fixture = TestBed.createComponent(ReporteBateladaSlide);
    fixture.detectChanges();
    fixture.componentInstance.abrir(orders(), [report()], null);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Qtde Aprovada');
    expect(text).toContain('Qtde Retrabalho');
    expect(text).toContain('Qtde Refugo');
    expect(text).not.toContain('Aprovada — Ordem 450002');
    expect(text).not.toContain('Aprovada — Ordem 450001');
    expect(text).toContain('Ordem');
    expect(text).toContain('Data/Hora');
    expect(text).toContain('Retrabalho');
    expect(text).not.toContain('Nenhum reporte realizado nesta batelada.');
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('th[scope="col"]')).toHaveLength(5);
  });

  it('renders zero quantities as empty fields when starting a batch report', async () => {
    TestBed.configureTestingModule({
      imports: [ReporteBateladaSlide],
      providers: [
        provideNoopAnimations(),
        { provide: PoDialogService, useValue: { confirm: vi.fn() } },
        { provide: MotivoRefugoService, useValue: { buscarMotivos: () => of([]) } },
      ],
    });
    const fixture = TestBed.createComponent(ReporteBateladaSlide);
    fixture.detectChanges();
    fixture.componentInstance.abrir(orders(), [], null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const quantityInputs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        '.batch-report__fields input',
      ),
    ];

    expect(quantityInputs).toHaveLength(6);
    expect(quantityInputs.map(input => input.value)).toEqual(['', '', '', '', '', '']);
    expect(fixture.componentInstance.items.every(item =>
      item.quantidadeAprovada === 0 &&
      item.quantidadeRetrabalho === 0 &&
      item.quantidadeRefugo === 0)).toBe(true);
  });

  it('shows Motivo Refugo only for orders with scrap and removes the legacy reason editor', () => {
    TestBed.configureTestingModule({
      imports: [ReporteBateladaSlide],
      providers: [
        provideNoopAnimations(),
        { provide: PoDialogService, useValue: { confirm: vi.fn() } },
        { provide: MotivoRefugoService, useValue: { buscarMotivos: () => of([{ codigo: '05', descricao: 'Borra', materialScrap: true, rework: true }]) } },
      ],
    });
    const fixture = TestBed.createComponent(ReporteBateladaSlide);
    fixture.componentInstance.abrir(orders(), [], null);
    fixture.componentInstance.atualizarQuantidade('2', 'quantidadeRetrabalho', 1);
    fixture.componentInstance.atualizarQuantidade('1', 'quantidadeRefugo', 2);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const reworkOrder = [...host.querySelectorAll('.batch-report__order')]
      .find(order => order.textContent?.includes('Ordem 450002'));
    const scrapOrder = [...host.querySelectorAll('.batch-report__order')]
      .find(order => order.textContent?.includes('Ordem 450001'));
    const scrapReason = scrapOrder?.querySelector('po-select');

    expect(reworkOrder?.querySelector('po-select')?.textContent).toContain('Motivo de retrabalho');
    expect(scrapReason).toBeTruthy();
    expect(scrapReason?.textContent ?? '').toContain('Motivo de refugo');
    expect(host.textContent).not.toContain('Editar Motivo');
    expect(host.textContent).not.toContain('Quantidade do motivo');
    expect(host.textContent).not.toContain('Adicionar motivo');
  });

  it('keeps every order in composition order and emits one typed multi-order draft', () => {
    const { component } = createComponent();
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.abrir(orders(), [], null);

    component.atualizarQuantidade('2', 'quantidadeAprovada', 4);
    component.atualizarQuantidade('1', 'quantidadeRetrabalho', 2);
    component.atualizarMotivo('1', '05', 'retrabalho');
    component.salvar();
    component.salvar();

    expect(component.items.map(item => item.orderId)).toEqual(['2', '1']);
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted.mock.calls[0][0]).toEqual({
      schemaVersion: 2,
      idempotencyKey: expect.any(String),
      finalizarSplit: false,
      items: [
        expect.objectContaining({ orderId: '2', quantidadeAprovada: 4 }),
        expect.objectContaining({ orderId: '1', quantidadeRetrabalho: 2 }),
      ],
    });
  });

  it('preserves the same key after failure and invalidates it only after material change', () => {
    const { component } = createComponent();
    const emitted: Array<{ readonly idempotencyKey: string | null }> = [];
    component.reporteSolicitado.subscribe(draft => emitted.push(draft));
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', 1);

    component.salvar();
    component.informarErro('Resposta perdida.');
    component.atualizarQuantidade('2', 'quantidadeAprovada', 1);
    component.salvar();
    component.informarErro('Resposta perdida.');
    component.atualizarQuantidade('2', 'quantidadeAprovada', 2);
    component.salvar();

    expect(emitted[1].idempotencyKey).toBe(emitted[0].idempotencyKey);
    expect(emitted[2].idempotencyKey).not.toBe(emitted[1].idempotencyKey);
  });

  it('derives the single selected reason quantity from the order scrap quantity', () => {
    const { component } = createComponent();
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', 1);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 2);
    component.atualizarMotivo('2', '05');

    component.salvar();

    expect(component.validationMessage).toBe('');
    expect(emitted.mock.calls[0][0].items[0].motivos).toEqual([
      { codigo: '05', descricao: 'Borra', quantidadeRetrabalho: 0, quantidadeRefugo: 2 },
    ]);
    expect(component.items[1].refugoItens).toEqual([]);
  });

  it('keeps the selected reason quantity synchronized and clears it with zero scrap', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 2);
    component.atualizarMotivo('2', '05');

    component.atualizarQuantidade('2', 'quantidadeRefugo', 3.5);
    expect(component.items[0].motivos).toEqual([
      { codigo: '05', descricao: 'Borra', quantidadeRetrabalho: 0, quantidadeRefugo: 3.5 },
    ]);

    component.atualizarQuantidade('2', 'quantidadeRefugo', 0);
    expect(component.items[0].motivos).toEqual([]);
  });

  it('rejects an aggregate overflow even when each quantity is finite', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', Number.MAX_VALUE);
    component.atualizarQuantidade('2', 'quantidadeRetrabalho', Number.MAX_VALUE);

    component.salvar();

    expect(component.validationMessage).toBe('O total informado excede o limite permitido.');
  });

  it('restores defensive history, renders invalid dates safely and stays open after success', () => {
    const { component, pageSlide } = createComponent();
    const confirmed = report();
    component.abrir(orders(), [confirmed], null);

    (confirmed.items[0].refugoItens[0] as { quantidade: number }).quantidade = 99;
    expect(component.historico[0].items[0].refugoItens[0].quantidade).toBe(1);
    expect(component.formatDataHora(new Date('invalid'))).toBe('Data inválida');

    component.atualizarQuantidade('2', 'quantidadeAprovada', 1);
    component.salvar();
    component.confirmarReporte({ ...report(), reporteId: 'report-2', idempotencyKey: 'idem-2' });

    expect(component.historico).toHaveLength(2);
    expect(component.hasDraft).toBe(false);
    expect(pageSlide.close).not.toHaveBeenCalled();
  });

  it('confirms discard only when closing an altered draft', () => {
    const { component, dialog, pageSlide } = createComponent();
    component.abrir(orders(), [], null);
    component.voltar();
    expect(pageSlide.close).toHaveBeenCalledOnce();

    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', 1);
    component.voltar();

    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Descartar reporte?',
      confirm: expect.any(Function),
    }));
  });

  it('treats a selected scrap reason as unsaved work', () => {
    const { component, dialog } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 1);
    component.atualizarMotivo('2', '05');

    component.voltar();

    expect(component.hasDraft).toBe(true);
    expect(dialog.confirm).toHaveBeenCalledOnce();
  });

  it('loads the shared scrap reason catalog only once for multiple orders', () => {
    const reasons = new Subject<ReadonlyArray<{ codigo: string; descricao: string }>>();
    const motivoService = {
      buscarMotivos: vi.fn(() => reasons),
    };
    const { component } = createComponent(motivoService);
    component.abrir(orders(), [], null);

    component.atualizarQuantidade('2', 'quantidadeRefugo', 1);
    component.atualizarQuantidade('1', 'quantidadeRefugo', 1);
    reasons.next([{ codigo: 'NEW', descricao: 'Atual' }]);

    expect(motivoService.buscarMotivos).toHaveBeenCalledOnce();
    expect(component.motivoOptions).toEqual([
      { codigo: 'NEW', label: 'NEW - Atual', value: 'NEW', descricao: 'Atual' },
    ]);
  });

  it('updates loaded history without resetting a selected scrap reason', () => {
    const { component, pageSlide } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 1);
    component.atualizarMotivo('2', '05');
    component.salvando = true;

    component.atualizarHistorico([report()]);

    expect(component.historico).toHaveLength(1);
    expect(component.salvando).toBe(true);
    expect(component.items[0].motivos).toEqual([
      { codigo: '05', descricao: 'Borra', quantidadeRetrabalho: 0, quantidadeRefugo: 1 },
    ]);
    expect(pageSlide.open).toHaveBeenCalledOnce();
  });
});

function createComponent(
  motivoService: { buscarMotivos: ReturnType<typeof vi.fn> } = {
    buscarMotivos: vi.fn(() => of([
      { codigo: '05', descricao: 'Borra', materialScrap: true, rework: true },
      { codigo: '18', descricao: 'Quebra', materialScrap: true, rework: true },
    ])),
  },
) {
  const pageSlide = { open: vi.fn(), close: vi.fn() };
  const dialog = { confirm: vi.fn() };
  const component = new ReporteBateladaSlide(
    { markForCheck: vi.fn() } as never,
    dialog as never,
    motivoService as never,
  );
  Object.defineProperty(component, 'pageSlide', { value: pageSlide });
  return { component, dialog, pageSlide };
}

function orders(): ReadonlyArray<OrdemLiberadaBatelada> {
  return [
    { id: '2', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '10', split: '01' },
    { id: '1', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
  ];
}

function report(): ReporteParcialBatelada {
  return {
    reporteId: 'report-1',
    batchId: 'batch-1',
    idempotencyKey: 'idem-1',
    confirmadoEm: new Date(2026, 6, 23, 10),
    items: [
      {
        orderId: '2',
        ordem: '450002',
        quantidadeAprovada: 2,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 1,
        refugoItens: [{ motivoCode: '05', descricao: 'Borra', quantidade: 1 }],
      },
      {
        orderId: '1',
        ordem: '450001',
        quantidadeAprovada: 3,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 0,
        refugoItens: [],
      },
    ],
  };
}
