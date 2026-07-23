import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { ContextoProducaoBatelada } from './contexto-producao';

describe('ContextoProducaoBatelada', () => {
  let fixture: ComponentFixture<ContextoProducaoBatelada>;
  let component: ContextoProducaoBatelada;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ContextoProducaoBatelada] }).compileComponents();
    fixture = TestBed.createComponent(ContextoProducaoBatelada);
    component = fixture.componentInstance;
    component.areas = [{ code: '4001', description: 'Produção' }];
    component.centers = [{
      code: 'CT-EXT-01',
      description: 'Extrusão Linha 01',
      areaCode: '4001',
      area: 'Produção',
      machineGroup: 'Extrusoras',
      establishment: '101',
      active: true,
    }];
    fixture.detectChanges();
  });

  it('enforces Area → CT dependency and a complete context before consultation', () => {
    expect(component.centerDisabled).toBe(true);
    expect(component.consultDisabled).toBe(true);

    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';

    expect(component.centerDisabled).toBe(false);
    expect(component.consultDisabled).toBe(false);
  });

  it('keeps fields visible while loading and exposes status and retry semantics', () => {
    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';
    component.loadingOrders = true;
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[role="status"]'))).toBeTruthy();
    expect(fixture.debugElement.queryAll(By.css('po-select')).length).toBe(2);

    fixture.componentRef.setInput('loadingOrders', false);
    fixture.componentRef.setInput('errorMessage', 'Falha ao consultar ordens.');
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[role="alert"]'))).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Tentar novamente');
  });

  it('locks Area and CT after batch start', () => {
    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';
    component.disabled = true;

    expect(component.centerDisabled).toBe(true);
    expect(component.consultDisabled).toBe(true);
  });
});
