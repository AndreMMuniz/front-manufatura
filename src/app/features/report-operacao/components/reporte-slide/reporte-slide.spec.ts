import { vi } from 'vitest';

import { ReporteSlide } from './reporte-slide';

describe('ReporteSlide', () => {
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
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);
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
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);
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

  it('emits a directly entered scrap quantity without requiring reasons', () => {
    const component = new ReporteSlide({ markForCheck: vi.fn() } as never, { confirm: vi.fn() } as never);
    const emitted = vi.fn();
    component.reporteSolicitado.subscribe(emitted);
    component.atualizarQuantidade('quantidadeRefugo', 1.5);

    component.salvar();

    expect(component.quantidadeRefugo).toBe(1.5);
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeRefugo: 1.5,
    }));
  });
});
