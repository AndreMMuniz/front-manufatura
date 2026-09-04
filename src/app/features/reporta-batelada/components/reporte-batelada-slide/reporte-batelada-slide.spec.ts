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

  it('allows a batch report containing only rework without a scrap reason', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRetrabalho', 2);

    expect(component.totalInformado).toBe(0);
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
        { provide: MotivoRefugoService, useValue: { buscarMotivos: () => of([]) } },
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

    expect(reworkOrder?.querySelector('po-select')).toBeNull();
    expect(scrapReason).toBeTruthy();
    expect(scrapReason?.textContent ?? '').toContain('Motivo Refugo');
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
    component.salvar();
    component.salvar();

    expect(component.items.map(item => item.orderId)).toEqual(['2', '1']);
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted.mock.calls[0][0]).toEqual({
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
    expect(emitted.mock.calls[0][0].items[0].refugoItens).toEqual([
      { motivoCode: '05', descricao: 'Borra', quantidade: 2 },
    ]);
    expect(component.items[1].refugoItens).toEqual([]);
  });

  it('keeps the selected reason quantity synchronized and clears it with zero scrap', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 2);
    component.atualizarMotivo('2', '05');

    component.atualizarQuantidade('2', 'quantidadeRefugo', 3.5);
    expect(component.items[0].refugoItens).toEqual([
      { motivoCode: '05', descricao: 'Borra', quantidade: 3.5 },
    ]);

    component.atualizarQuantidade('2', 'quantidadeRefugo', 0);
    expect(component.items[0].refugoItens).toEqual([]);
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
      { label: 'NEW - Atual', value: 'NEW', descricao: 'Atual' },
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
    expect(component.items[0].refugoItens).toEqual([
      { motivoCode: '05', descricao: 'Borra', quantidade: 1 },
    ]);
    expect(pageSlide.open).toHaveBeenCalledOnce();
  });
});

function createComponent(
  motivoService: { buscarMotivos: ReturnType<typeof vi.fn> } = {
    buscarMotivos: vi.fn(() => of([
      { codigo: '05', descricao: 'Borra' },
      { codigo: '18', descricao: 'Quebra' },
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
