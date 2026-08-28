import { vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ReporteSlide } from './reporte-slide';
import { MotivoRefugoService } from '../../services/motivo-refugo.service';

const scrapReasonService = {
  buscarMotivos: vi.fn(() => of([{ codigo: '05', descricao: 'Borra' }])),
};

describe('ReporteSlide', () => {
  it('mostra Motivo Refugo automaticamente e remove controles de quantidade do motivo', async () => {
    await TestBed.configureTestingModule({
      imports: [ReporteSlide],
      providers: [
        provideNoopAnimations(),
        { provide: MotivoRefugoService, useValue: scrapReasonService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ReporteSlide);

    fixture.detectChanges();
    fixture.componentInstance.abrir([]);
    fixture.componentInstance.atualizarQuantidade('quantidadeRefugo', 2);
    fixture.detectChanges();

    expect(scrapReasonService.buscarMotivos).toHaveBeenCalledWith('');
    expect(document.body.textContent).toContain('Motivo Refugo');
    expect(document.body.textContent).not.toContain('Editar Motivo');
    expect(document.body.textContent).not.toContain('Qtde do motivo');
    expect(document.body.textContent).not.toContain('Adicionar motivo');
  });

  it('sums only approved and scrap quantities in the displayed total', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    component.quantidadeAprovada = 100;
    component.quantidadeRetrabalho = 2;
    component.quantidadeRefugo = 10;

    expect(component.totalInformado).toBe(110);
  });

  it('permite retrabalho sem motivo e exige motivo quando há refugo', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    component.atualizarQuantidade('quantidadeRetrabalho', 1);
    expect(component.canSave).toBe(true);

    component.atualizarQuantidade('quantidadeRefugo', 1);
    expect(component.canSave).toBe(false);
  });

  it('limpa o motivo ao voltar a quantidade de refugo para zero', () => {
    const component = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm: vi.fn() } as never,
      scrapReasonService as never,
    );
    component.atualizarQuantidade('quantidadeRefugo', 2);
    component.atualizarMotivo('05');

    component.atualizarQuantidade('quantidadeRefugo', 0);

    expect(component.motivoCodigo).toBe('');
  });

  it('emits one draft and blocks duplicate saves while waiting for the service', () => {
    const component = new ReporteSlide({} as never, { confirm: vi.fn() } as never);
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.quantidadeAprovada = 2;

    component.salvar();
    component.salvar();

    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.any(String),
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
    }));
  });

  it('keeps the draft on failure and resets it after a successful report', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    component.quantidadeAprovada = 3;
    component.salvando = true;

    component.informarErro('Falha de comunicação.');

    expect(component.quantidadeAprovada).toBe(3);
    expect(component.validationMessage).toBe('Falha de comunicação.');

    const pageSlide = { close: vi.fn() };
    const pwaWorkState = { setCaptureActive: vi.fn() };
    const confirmComponent = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm: vi.fn() } as never,
      scrapReasonService as never,
      pwaWorkState as never,
    );
    (confirmComponent as unknown as { pageSlide: typeof pageSlide }).pageSlide = pageSlide;
    (confirmComponent as unknown as { slideOpen: boolean }).slideOpen = true;
    confirmComponent.salvando = true;
    confirmComponent.quantidadeAprovada = 3;
    confirmComponent.confirmarReporte({
      id: 'APT-1',
      idempotencyKey: 'draft-1',
      registradoEm: new Date(2026, 6, 23, 10),
      dataInicio: new Date(2026, 6, 23, 9),
      horaInicio: '09:00',
      dataFim: new Date(2026, 6, 23, 10),
      horaFim: '10:00',
      quantidadeAprovada: 3,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
    });

    expect(confirmComponent.quantidadeAprovada).toBe(0);
    expect(confirmComponent.historico).toHaveLength(1);
    expect(pageSlide.close).toHaveBeenCalledOnce();
    expect(pwaWorkState.setCaptureActive).toHaveBeenLastCalledWith('report-operation', false);
  });

  it('reuses the idempotency key when retrying the same preserved draft', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    const emitted: Array<{ idempotencyKey?: string }> = [];
    component.reporteSolicitado.subscribe(draft => emitted.push(draft));
    component.quantidadeAprovada = 1;

    component.salvar();
    component.informarErro('Resposta perdida.');
    component.atualizarQuantidade('quantidadeAprovada', 1);
    component.salvar();

    expect(emitted).toHaveLength(2);
    expect(emitted[1].idempotencyKey).toBe(emitted[0].idempotencyKey);
  });

  it('disables saving when any quantity is negative or non-finite', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);
    component.quantidadeAprovada = 10;
    component.quantidadeRefugo = -1;

    expect(component.canSave).toBe(false);

    component.quantidadeRefugo = 0;
    component.quantidadeRetrabalho = Number.NaN;

    expect(component.canSave).toBe(false);
  });

  it('preserves an invalid scrap entry so the operator receives validation feedback', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);
    component.quantidadeAprovada = 1;

    component.atualizarQuantidade('quantidadeRefugo', -0.5);
    component.salvar();

    expect(component.quantidadeRefugo).toBe(-0.5);
    expect(component.validationMessage).toBe('As quantidades não podem ser negativas.');
  });

  it('renders a safe fallback for an invalid restored date', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);

    expect(component.formatDataHora(new Date('invalid'))).toBe('Data inválida');
  });

  it('exige motivo quando há refugo sem motivo selecionado', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.ordem = '450001';
    component.atualizarQuantidade('quantidadeRefugo', 1.5);

    expect(component.canSave).toBe(false);
    component.salvar();

    expect(emitted).not.toHaveBeenCalled();
    expect(component.validationMessage).toBe(
      'Informe um motivo de refugo da Ordem 450001.',
    );
  });

  it('deriva a quantidade do motivo da própria quantidade de refugo', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    const emitted = vi.spyOn(component.reporteSolicitado, 'emit');
    component.atualizarQuantidade('quantidadeAprovada', 10);
    component.atualizarQuantidade('quantidadeRefugo', 2);
    component.atualizarMotivo('05');
    component.salvar();

    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeRefugo: 2,
      refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 2 }],
    }));
  });

  it('keeps the report open and reports an error when the reasons catalog fails', () => {
    const component = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm: vi.fn() } as never,
      { buscarMotivos: vi.fn(() => throwError(() => new Error('network'))) } as never,
    );
    component.quantidadeAprovada = 1;

    component.atualizarQuantidade('quantidadeRefugo', 1);

    expect(component.quantidadeAprovada).toBe(1);
    expect(component.validationMessage).toBe('Não foi possível carregar os motivos de refugo.');
  });

  it('emits the same three-decimal values used by reason validation', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.atualizarQuantidade('quantidadeRefugo', 1.2344);
    component.atualizarMotivo('05');

    component.salvar();

    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeRefugo: 1.234,
      refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 1.234 }],
    }));
  });
});
