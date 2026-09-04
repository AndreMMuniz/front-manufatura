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
  it('mostra Motivo de Refugo/Retrabalho quando houver retrabalho', async () => {
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
    fixture.componentInstance.atualizarQuantidade('quantidadeRetrabalho', 2);
    fixture.detectChanges();

    expect(scrapReasonService.buscarMotivos).toHaveBeenCalledWith('');
    const motivo = fixture.nativeElement.querySelector('po-select[name="reporteMotivoRefugo"]');
    expect(motivo).not.toBeNull();
    expect(motivo.textContent).toContain('Motivo de Refugo/Retrabalho');
    expect(fixture.nativeElement.querySelectorAll('po-number')).toHaveLength(3);
    expect(fixture.nativeElement.querySelectorAll('.reporte-slide__footer po-button')).toHaveLength(2);
  });

  it('renders zero quantities as empty fields when starting an order report', async () => {
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
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const quantityInputs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        '.reporte-slide__entry input',
      ),
    ];

    expect(quantityInputs).toHaveLength(3);
    expect(quantityInputs.map(input => input.value)).toEqual(['', '', '']);
    expect(fixture.componentInstance.quantidadeAprovada).toBe(0);
    expect(fixture.componentInstance.quantidadeRetrabalho).toBe(0);
    expect(fixture.componentInstance.quantidadeRefugo).toBe(0);
  });

  it('sums only approved and scrap quantities in the displayed total', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    component.quantidadeAprovada = 100;
    component.quantidadeRetrabalho = 2;
    component.quantidadeRefugo = 10;

    expect(component.totalInformado).toBe(110);
  });

  it('exige o mesmo motivo quando há retrabalho ou refugo', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    component.atualizarQuantidade('quantidadeRetrabalho', 1);
    expect(component.canSave).toBe(false);

    component.atualizarMotivo('05');
    expect(component.canSave).toBe(true);

    component.atualizarQuantidade('quantidadeRefugo', 1);
    expect(component.canSave).toBe(true);
  });

  it('mantém o motivo enquanto houver retrabalho e limpa quando ambos voltam a zero', () => {
    const component = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm: vi.fn() } as never,
      scrapReasonService as never,
    );
    component.atualizarQuantidade('quantidadeRefugo', 2);
    component.atualizarQuantidade('quantidadeRetrabalho', 1);
    component.atualizarMotivo('05');

    component.atualizarQuantidade('quantidadeRefugo', 0);
    expect(component.motivoCodigo).toBe('05');

    component.atualizarQuantidade('quantidadeRetrabalho', 0);

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

  it('preserva a chave para o mesmo motivo e a invalida quando o motivo realmente muda', () => {
    const component = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm: vi.fn() } as never,
      scrapReasonService as never,
    );
    component.motivoOptions = [
      { label: '05 - Borra', value: '05', descricao: 'Borra' },
      { label: '07 - Trinca', value: '07', descricao: 'Trinca' },
    ];
    const emitted: Array<{ idempotencyKey?: string }> = [];
    component.reporteSolicitado.subscribe(draft => emitted.push(draft));
    component.atualizarQuantidade('quantidadeRefugo', 1);
    component.atualizarMotivo('05');

    component.salvar();
    component.informarErro('Resposta perdida.');
    component.atualizarMotivo('05');
    component.salvar();
    component.informarErro('Falha local.');
    component.atualizarMotivo('07');
    component.salvar();

    expect(emitted).toHaveLength(3);
    expect(emitted[1].idempotencyKey).toBe(emitted[0].idempotencyKey);
    expect(emitted[2].idempotencyKey).not.toBe(emitted[1].idempotencyKey);
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

  it.each([
    ['SYNCED', 'Enviado ao Datasul'],
    ['ERROR', 'Rejeitado pelo Datasul'],
    [undefined, 'Envio pendente'],
  ] as const)('renderiza o rótulo histórico de %s', async (deliveryStatus, expectedLabel) => {
    await TestBed.configureTestingModule({
      imports: [ReporteSlide],
      providers: [
        provideNoopAnimations(),
        { provide: MotivoRefugoService, useValue: scrapReasonService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ReporteSlide);
    fixture.detectChanges();

    fixture.componentInstance.abrir([{
      id: 'report-1',
      idempotencyKey: 'report-1',
      registradoEm: new Date('2026-08-28T10:00:00.000Z'),
      dataInicio: new Date('2026-08-28T09:00:00.000Z'),
      horaInicio: '09:00',
      dataFim: new Date('2026-08-28T10:00:00.000Z'),
      horaFim: '10:00',
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
      ...(deliveryStatus ? { deliveryStatus } : {}),
    }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.reporte-slide__delivery-status')?.textContent)
      .toContain(expectedLabel);
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
      'Informe um motivo de Refugo/Retrabalho da Ordem 450001.',
    );
  });

  it('exige motivo quando há somente retrabalho e envia a quantidade afetada', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    const emitted = vi.spyOn(component.reporteSolicitado, 'emit');
    component.ordem = '450001';
    component.atualizarQuantidade('quantidadeRetrabalho', 2);

    component.salvar();

    expect(emitted).not.toHaveBeenCalled();
    expect(component.validationMessage).toBe(
      'Informe um motivo de Refugo/Retrabalho da Ordem 450001.',
    );

    component.atualizarMotivo('05');
    component.salvar();

    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeRetrabalho: 2,
      quantidadeRefugo: 0,
      refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 2 }],
    }));
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
    expect(component.validationMessage).toBe('Não foi possível carregar os motivos de Refugo/Retrabalho.');
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
