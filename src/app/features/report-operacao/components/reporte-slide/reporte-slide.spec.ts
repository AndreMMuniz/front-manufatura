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
    expect(emitted).toHaveBeenCalledWith({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
    });
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
      registradoEm: new Date(2026, 6, 23, 10),
      quantidadeAprovada: 3,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
    });

    expect(component.quantidadeAprovada).toBe(0);
    expect(component.historico).toHaveLength(1);
  });
});
