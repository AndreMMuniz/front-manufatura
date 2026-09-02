import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { StopEntry, StopId } from '../../models/reporte-paradas.model';
import { ParadasEmAndamentoList } from './paradas-em-andamento-list';

describe('ParadasEmAndamentoList', () => {
  async function setup() {
    await TestBed.configureTestingModule({ imports: [ParadasEmAndamentoList] }).compileComponents();
    const fixture = TestBed.createComponent(ParadasEmAndamentoList);
    return { fixture, component: fixture.componentInstance };
  }

  it('distingue loading, erro com retry e vazio por regiões acessíveis', async () => {
    const { fixture, component } = await setup();
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Consultando');

    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('errorMessage', 'Consulta indisponível');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent)
      .toContain('Consulta indisponível');

    fixture.componentRef.setInput('errorMessage', '');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent)
      .toContain('Nenhuma parada');
  });

  it('seleciona por id com clique/teclado e expõe nome e estado acessíveis', async () => {
    const { fixture, component } = await setup();
    fixture.componentRef.setInput('stops', [stop()]);
    fixture.componentRef.setInput('now', new Date(2026, 6, 28, 9, 2, 59));
    const selected: StopId[] = [];
    component.selectStop.subscribe(id => selected.push(id));
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('button'));
    expect(button.nativeElement.getAttribute('aria-label')).toContain('Setup');
    expect(button.nativeElement.textContent).toContain('01:02:00');
    expect(button.nativeElement.textContent).toContain('pendente');
    expect(button.nativeElement.getAttribute('aria-label')).toContain('Sincronização pendente');
    button.triggerEventHandler('click');

    expect(selected).toEqual([42]);
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
