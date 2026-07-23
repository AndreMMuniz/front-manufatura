import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PoDialogService } from '@po-ui/ng-components';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MotivoRefugoService } from '../../../report-operacao/services/motivo-refugo.service';
import { OrdemLiberadaBatelada, ReporteParcialBatelada } from '../../models/reporta-batelada.model';

import { ReporteBateladaSlide } from './reporte-batelada-slide';

describe('ReporteBateladaSlide', () => {
  it('renders unique accessible order labels and the ordered history columns in the DOM', () => {
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
    expect(text).toContain('Aprovada — Ordem 450002');
    expect(text).toContain('Aprovada — Ordem 450001');
    expect(text).toContain('Ordem');
    expect(text).toContain('Data/Hora');
    expect(text).toContain('Retrabalho');
    expect(text).not.toContain('Nenhum reporte realizado nesta batelada.');
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

  it('validates quantities and scrap reasons independently for each order', () => {
    const { component } = createComponent();
    component.abrir(orders(), [], null);
    component.atualizarQuantidade('2', 'quantidadeAprovada', 1);
    component.atualizarQuantidade('2', 'quantidadeRefugo', 2);
    component.editarRefugo('2');
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(1);
    component.adicionarMotivo();

    component.salvar();

    expect(component.validationMessage)
      .toBe('Os motivos de refugo da ordem 450002 devem totalizar 2,000.');
    expect(component.items[1].refugoItens).toEqual([]);
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
});

function createComponent() {
  const pageSlide = { open: vi.fn(), close: vi.fn() };
  const dialog = { confirm: vi.fn() };
  const component = new ReporteBateladaSlide(
    { markForCheck: vi.fn() } as never,
    dialog as never,
    { buscarMotivos: vi.fn(() => of([
      { codigo: '05', descricao: 'Borra' },
      { codigo: '18', descricao: 'Quebra' },
    ])) } as never,
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
