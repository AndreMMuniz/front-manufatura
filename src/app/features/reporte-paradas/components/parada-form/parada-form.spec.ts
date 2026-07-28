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
});
