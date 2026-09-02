import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { StopEntry } from '../../models/reporte-paradas.model';
import { FinalizarParadaForm } from './finalizar-parada-form';

describe('FinalizarParadaForm', () => {
  async function setup() {
    await TestBed.configureTestingModule({ imports: [FinalizarParadaForm] }).compileComponents();
    const fixture = TestBed.createComponent(FinalizarParadaForm);
    fixture.componentRef.setInput('stop', stop());
    fixture.componentRef.setInput('draft', { endDate: '2026-07-28', endTime: '08:00' });
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('mostra resumo readonly da própria parada e aceita fim igual ao início', async () => {
    const { fixture, component } = await setup();

    expect(fixture.nativeElement.textContent).toContain('Setup');
    expect(fixture.nativeElement.textContent).toContain('Ana');
    expect(component.form.valid).toBe(true);
  });

  it('rejeita fim anterior e campos inválidos', async () => {
    const { component } = await setup();
    component.form.patchValue({ endTime: '07:59' });
    expect(component.form.hasError('interval')).toBe(true);
    component.form.patchValue({ endTime: '25:00' });
    expect(component.form.invalid).toBe(true);
  });

  it('insere os dois-pontos ao digitar a hora da finalização', async () => {
    const { fixture, component } = await setup();
    const endTime = fixture.nativeElement.querySelector(
      'input[name="horaFinalizacao"]',
    ) as HTMLInputElement;

    endTime.value = '1533';
    endTime.dispatchEvent(new Event('input', { bubbles: true }));

    expect(endTime.value).toBe('15:33');
    expect(component.form.controls.endTime.value).toBe('15:33');
  });

  it('bloqueia controles conflitantes durante finalização', async () => {
    const { fixture, component } = await setup();
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    expect(component.form.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('button[type="submit"]')?.disabled).toBe(true);
  });

  function stop(): StopEntry {
    return {
      id: 42,
      context: {
        area: { code: '4001', description: 'Produção' },
        workCenter: {
          code: 'CT-EXT-01',
          description: 'Extrusão',
          areaCode: '4001',
          area: 'Produção',
          machineGroup: 'Extrusoras',
          establishment: '101',
          active: true,
        },
      },
      reason: { id: 1, code: '01', description: 'Setup' },
      responsible: { tipo: 'OPERADOR', codigo: '001', nome: 'Ana' },
      startDate: new Date(2026, 6, 28),
      startTime: '08:00',
      status: 'EM_ANDAMENTO',
      idempotencyKey: 'start-42',
      syncStatus: 'PENDING',
    };
  }
});
