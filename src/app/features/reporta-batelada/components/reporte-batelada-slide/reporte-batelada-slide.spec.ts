import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PoDialogService } from '@po-ui/ng-components';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MotivoRefugoService } from '../../../report-operacao/services/motivo-refugo.service';
import { OrdemLiberadaBatelada, ReporteParcialBatelada } from '../../models/reporta-batelada.model';

import { ReporteBateladaSlide } from './reporte-batelada-slide';

describe('ReporteBateladaSlide', () => {
  it('sums only approved and scrap quantities in the displayed total', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', 100);
    component.atualizarQuantidade('2', 'quantidadeRetrabalho', 2);
    component.atualizarQuantidade('1', 'quantidadeRefugo', 10);

    expect(component.totalInformado).toBe(110);
  });

  it('requires one reason for a batch report containing only rework', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeRetrabalho', 2);

    expect(component.totalInformado).toBe(0);
    expect(component.canSave).toBe(false);
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

  it('renders the rework/scrap reason label without the order number', () => {
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
    fixture.componentInstance.editarRefugo('2');
    fixture.detectChanges();

    const reasonEditor = (fixture.nativeElement as HTMLElement)
      .querySelector('.batch-report__reason-editor');
    expect(reasonEditor?.textContent).toContain('Motivo do Retrabalho/Refugo');
    expect(reasonEditor?.textContent).not.toContain('Motivo — Ordem 450002');
  });

  it('keeps every order in composition order and emits one typed multi-order draft', () => {
    const { component } = createComponent();
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.abrir(orders(), [], null);

    component.atualizarQuantidade('2', 'quantidadeAprovada', 4);
    component.atualizarQuantidade('1', 'quantidadeRetrabalho', 2);
    component.editarRefugo('1');
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(2);
    component.adicionarMotivo();
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

  it('accepts a single reason independently of its display quantity', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', 1);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 2);
    component.editarRefugo('2');
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(1);
    component.adicionarMotivo();

    component.salvar();

    expect(component.validationMessage).toBe('');
    expect(component.items[1].refugoItens).toEqual([]);
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

  it('treats an unfinished reason editor as unsaved work', () => {
    const { component, dialog } = createComponent();
    component.abrir(orders(), [], null);
    component.editarRefugo('2');
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(1);

    component.voltar();

    expect(component.hasDraft).toBe(true);
    expect(dialog.confirm).toHaveBeenCalledOnce();
  });

  it('ignores an obsolete scrap-reason response after another order is selected', () => {
    const first = new Subject<ReadonlyArray<{ codigo: string; descricao: string }>>();
    const second = new Subject<ReadonlyArray<{ codigo: string; descricao: string }>>();
    const motivoService = {
      buscarMotivos: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    };
    const { component } = createComponent(motivoService);
    component.abrir(orders(), [], null);

    component.editarRefugo('2');
    component.editarRefugo('1');
    first.next([{ codigo: 'OLD', descricao: 'Obsoleto' }]);
    second.next([{ codigo: 'NEW', descricao: 'Atual' }]);

    expect(component.motivoOptions).toEqual([{ label: 'NEW - Atual', value: 'NEW' }]);
  });

  it('updates loaded history without resetting an in-progress editor', () => {
    const { component, pageSlide } = createComponent();
    component.abrir(orders(), [], null);
    component.editarRefugo('2');
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(1);
    component.salvando = true;

    component.atualizarHistorico([report()]);

    expect(component.historico).toHaveLength(1);
    expect(component.salvando).toBe(true);
    expect(component.editingOrderId).toBe('2');
    expect(component.motivoCodigo).toBe('05');
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
