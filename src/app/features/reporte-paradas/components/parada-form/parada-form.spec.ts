import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ParadaForm } from './parada-form';

describe('ParadaForm', () => {
  it('exige motivo e início e aceita fim completamente vazio', async () => {
    await TestBed.configureTestingModule({
      imports: [ParadaForm],
    }).compileComponents();
    const fixture = TestBed.createComponent(ParadaForm);
    fixture.componentRef.setInput('reasons', [
      { id: 1, code: '01', description: 'Setup' },
    ]);
    fixture.detectChanges();

    expect('programmed' in fixture.componentInstance.form.controls).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Parada Programada');
    expect(fixture.componentInstance.form.valid).toBe(false);

    fixture.componentInstance.form.patchValue({
      reasonId: 1,
      startDate: '2026-07-28',
      startTime: '08:00',
      endDate: null,
      endTime: '',
    });

    expect(fixture.componentInstance.form.valid).toBe(true);
  }, 10_000);

  it('insere os dois-pontos ao digitar as horas inicial e final', async () => {
    await TestBed.configureTestingModule({
      imports: [ParadaForm],
    }).compileComponents();
    const fixture = TestBed.createComponent(ParadaForm);
    fixture.detectChanges();

    const startTime = fixture.nativeElement.querySelector(
      'input[name="horaInicio"]',
    ) as HTMLInputElement;
    const endTime = fixture.nativeElement.querySelector(
      'input[name="horaFim"]',
    ) as HTMLInputElement;

    startTime.value = '1533';
    startTime.dispatchEvent(new Event('input', { bubbles: true }));
    endTime.value = '1745';
    endTime.dispatchEvent(new Event('input', { bubbles: true }));

    expect(startTime.value).toBe('15:33');
    expect(endTime.value).toBe('17:45');
    expect(fixture.componentInstance.form.controls.startTime.value).toBe('15:33');
    expect(fixture.componentInstance.form.controls.endTime.value).toBe('17:45');
  }, 10_000);

  it('rejeita fim parcial e emite confirmação somente para formulário válido', async () => {
    await TestBed.configureTestingModule({
      imports: [ParadaForm],
    }).compileComponents();
    const fixture = TestBed.createComponent(ParadaForm);
    fixture.detectChanges();
    const submitted: unknown[] = [];
    fixture.componentInstance.confirm.subscribe(value => submitted.push(value));

    fixture.componentInstance.form.patchValue({
      reasonId: 1,
      startDate: '2026-07-28',
      startTime: '08:00',
      endDate: '2026-07-28',
      endTime: '',
    });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.form.hasError('endPair')).toBe(true);
    expect(submitted).toEqual([]);

    fixture.componentInstance.form.patchValue({ endTime: '09:00' });
    fixture.componentInstance.submit();
    expect(submitted).toHaveLength(1);
  }, 10_000);

  it('finaliza pelo mesmo formulário somente com Data Final e Hora Final completas', async () => {
    await TestBed.configureTestingModule({
      imports: [ParadaForm],
    }).compileComponents();
    const fixture = TestBed.createComponent(ParadaForm);
    fixture.detectChanges();
    const submitted: unknown[] = [];
    const component = fixture.componentInstance as ParadaForm & {
      readonly finish?: { subscribe: (listener: (value: unknown) => void) => void };
    };
    component.finish?.subscribe(value => submitted.push(value));
    const finishButton = () => Array.from(
      fixture.nativeElement.querySelectorAll('.parada-form__actions button'),
    ).find(button => (button as HTMLButtonElement).textContent?.includes('Finalizar parada')) as
      HTMLButtonElement | undefined;

    expect(finishButton()).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('(opcional)');
    finishButton()?.click();
    fixture.detectChanges();
    expect(submitted).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('(opcional)');
    expect(fixture.nativeElement.textContent).toContain(
      'Data Final e Hora Final são obrigatórias para finalizar uma parada.',
    );

    component.form.patchValue({
      reasonId: null,
      startDate: null,
      startTime: '',
      endDate: '2026-08-14',
      endTime: '09:40',
    });
    fixture.detectChanges();
    finishButton()?.click();

    expect(submitted).toEqual([{
      endDate: '2026-08-14',
      endTime: '09:40',
    }]);
  }, 10_000);

  it('bloqueia todos os campos e a confirmação durante salvamento', async () => {
    await TestBed.configureTestingModule({
      imports: [ParadaForm],
    }).compileComponents();
    const fixture = TestBed.createComponent(ParadaForm);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('button[type="submit"]')?.disabled).toBe(true);
  }, 10_000);

  it('não emite finalização enquanto nenhuma parada estiver selecionada', async () => {
    await TestBed.configureTestingModule({
      imports: [ParadaForm],
    }).compileComponents();
    const fixture = TestBed.createComponent(ParadaForm);
    fixture.componentRef.setInput('finishDisabled', true);
    fixture.detectChanges();
    const submitted: unknown[] = [];
    fixture.componentInstance.finish.subscribe(value => submitted.push(value));
    fixture.componentInstance.form.patchValue({
      endDate: '2026-09-02',
      endTime: '15:00',
    });

    fixture.componentInstance.submitFinish();

    expect(submitted).toEqual([]);
    const finishButton = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find(button => (button as HTMLButtonElement).textContent?.includes('Finalizar parada')) as
      HTMLButtonElement;
    expect(finishButton.disabled).toBe(true);
  }, 10_000);

  it('alterna os campos de início e fim conforme a seleção da parada', async () => {
    await TestBed.configureTestingModule({
      imports: [ParadaForm],
    }).compileComponents();
    const fixture = TestBed.createComponent(ParadaForm);
    fixture.componentRef.setInput('finishDisabled', true);
    fixture.detectChanges();
    const field = (name: string) => fixture.nativeElement.querySelector(
      `input[name="${name}"]`,
    ) as HTMLInputElement;

    expect(field('dataInicio').disabled).toBe(false);
    expect(field('horaInicio').disabled).toBe(false);
    expect(field('dataFim').disabled).toBe(true);
    expect(field('horaFim').disabled).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('(opcional)');

    fixture.componentRef.setInput('finishDisabled', false);
    fixture.detectChanges();

    expect(field('dataInicio').disabled).toBe(true);
    expect(field('horaInicio').disabled).toBe(true);
    expect(field('dataFim').disabled).toBe(false);
    expect(field('horaFim').disabled).toBe(false);
  }, 10_000);
});
