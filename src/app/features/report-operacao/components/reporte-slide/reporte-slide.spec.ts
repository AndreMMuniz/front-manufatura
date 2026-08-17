import { vi } from 'vitest';
import { of, throwError } from 'rxjs';

import { ReporteSlide } from './reporte-slide';

const scrapReasonService = {
  buscarMotivos: vi.fn(() => of([{ codigo: '05', descricao: 'Borra' }])),
};

describe('ReporteSlide', () => {
  it('sums only approved and scrap quantities in the displayed total', () => {
    const component = new ReporteSlide({} as never, { confirm: vi.fn() } as never);
    component.quantidadeAprovada = 100;
    component.quantidadeRetrabalho = 2;
    component.quantidadeRefugo = 10;

    expect(component.totalInformado).toBe(110);
  });

  it('requires one reason when a report contains only rework', () => {
    const component = new ReporteSlide({} as never, { confirm: vi.fn() } as never);
    component.quantidadeRetrabalho = 2;

    expect(component.totalInformado).toBe(0);
    expect(component.canSave).toBe(false);
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

    component.confirmarReporte({
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

    expect(component.quantidadeAprovada).toBe(0);
    expect(component.historico).toHaveLength(1);
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

  it('requires exactly one reason for scrap or rework', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.ordem = '450001';
    component.atualizarQuantidade('quantidadeRefugo', 1.5);

    expect(component.canSave).toBe(false);
    component.salvar();

    expect(emitted).not.toHaveBeenCalled();
    expect(component.validationMessage).toBe(
      'Informe exatamente um motivo de refugo ou retrabalho da Ordem 450001.',
    );
  });

  it('adds, consolidates and removes scrap reasons', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    component.editarRefugo();

    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(1.25);
    component.adicionarMotivo();
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(0.75);
    component.adicionarMotivo();

    expect(component.refugoItens).toEqual([
      { codigo: '05', descricao: 'Borra', quantidade: 2 },
    ]);

    component.removerMotivo(0);

    expect(component.refugoItens).toEqual([]);
  });

  it('emits a defensive copy of valid reasons and preserves it after a failed request', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    const emitted: Array<{ idempotencyKey?: string; refugoItens?: ReadonlyArray<{ codigo: string }> }> = [];
    component.reporteSolicitado.subscribe(draft => emitted.push(draft));
    component.atualizarQuantidade('quantidadeRefugo', 2);
    component.editarRefugo();
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(2);
    component.adicionarMotivo();

    component.salvar();
    component.informarErro('Falha de comunicação.');
    component.salvar();

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toEqual(expect.objectContaining({
      quantidadeRefugo: 2,
      refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 2 }],
    }));
    expect(emitted[1].idempotencyKey).toBe(emitted[0].idempotencyKey);
    expect(emitted[1].refugoItens).not.toBe(emitted[0].refugoItens);
    expect(component.refugoItens).toEqual([
      { codigo: '05', descricao: 'Borra', quantidade: 2 },
    ]);
    expect(component.hasDraft).toBe(true);
  });

  it('asks before discarding a draft that contains only a reason', () => {
    const confirm = vi.fn();
    const component = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm } as never,
      scrapReasonService as never,
    );
    component.editarRefugo();
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(1);
    component.adicionarMotivo();

    component.voltar();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Descartar reporte?',
      message: 'Existem quantidades ainda não salvas. Deseja descartá-las?',
    }));
    expect(component.refugoItens).toHaveLength(1);
  });

  it('keeps the report open and reports an error when the reasons catalog fails', () => {
    const component = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm: vi.fn() } as never,
      { buscarMotivos: vi.fn(() => throwError(() => new Error('network'))) } as never,
    );
    component.quantidadeAprovada = 1;

    component.editarRefugo();

    expect(component.editingRefugo).toBe(true);
    expect(component.quantidadeAprovada).toBe(1);
    expect(component.validationMessage).toBe('Não foi possível carregar os motivos de refugo.');
  });

  it('clears stale catalog options before a reload that fails', () => {
    const buscarMotivos = vi.fn()
      .mockReturnValueOnce(of([{ codigo: '05', descricao: 'Borra' }]))
      .mockReturnValueOnce(throwError(() => new Error('network')));
    const component = new ReporteSlide(
      { markForCheck: vi.fn() } as never,
      { confirm: vi.fn() } as never,
      { buscarMotivos } as never,
    );

    component.editarRefugo();
    expect(component.motivoOptions).toHaveLength(1);
    component.editarRefugo();

    expect(component.motivoOptions).toEqual([]);
    expect(component.carregandoMotivos).toBe(false);
    expect(component.validationMessage).toBe('Não foi possível carregar os motivos de refugo.');
  });

  it('blocks saving while a reason entry has not been added', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.quantidadeAprovada = 1;
    component.editarRefugo();
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(0.5);

    component.salvar();

    expect(emitted).not.toHaveBeenCalled();
    expect(component.validationMessage).toBe(
      'Adicione ou limpe o motivo em edição antes de salvar o reporte.',
    );
  });

  it('rejects reason quantities that round to zero', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    component.editarRefugo();
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(0.0004);

    component.adicionarMotivo();

    expect(component.refugoItens).toEqual([]);
    expect(component.validationMessage).toContain('arredondamento para três casas');
  });

  it('emits the same three-decimal values used by reason validation', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never, scrapReasonService as never);
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.quantidadeRefugo = 1.2344;
    component.editarRefugo();
    component.atualizarMotivo('05');
    component.atualizarQuantidadeMotivo(1.2344);
    component.adicionarMotivo();

    component.salvar();

    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeRefugo: 1.234,
      refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 1.234 }],
    }));
  });
});
