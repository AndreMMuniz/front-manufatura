import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { WorkCenter } from '../../models/work-center';
import { ContextoProducaoSelector } from './contexto-producao-selector';

describe('ContextoProducaoSelector', () => {
  let fixture: ComponentFixture<ContextoProducaoSelector>;
  let component: ContextoProducaoSelector;

  const centers: ReadonlyArray<WorkCenter> = [{
    code: 'CT-EXT-01',
    description: 'Extrusão Linha 01',
    areaCode: '4001',
    area: 'Produção',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  }];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ContextoProducaoSelector] }).compileComponents();
    fixture = TestBed.createComponent(ContextoProducaoSelector);
    component = fixture.componentInstance;
    component.areas = [{ code: '4001', description: 'Produção' }];
    component.centers = centers;
    fixture.detectChanges();
  });

  it('mantém Centro bloqueado sem Área e formata somente os centros recebidos', () => {
    expect(component.centerDisabled).toBe(true);
    expect(component.centerOptions).toEqual([
      { value: 'CT-EXT-01', label: 'CT-EXT-01 - Extrusão Linha 01' },
    ]);

    component.areaCode = '4001';

    expect(component.centerDisabled).toBe(false);
  });

  it('emite mudanças sem mutar os inputs controlados pelo parent', () => {
    const areas: string[] = [];
    const centersChanged: string[] = [];
    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';
    component.areaChange.subscribe(value => areas.push(value));
    component.workCenterChange.subscribe(value => centersChanged.push(value));

    component.changeArea('4002');
    component.changeWorkCenter('CT-CQ-01');

    expect(component.areaCode).toBe('4001');
    expect(component.workCenterCode).toBe('CT-EXT-01');
    expect(areas).toEqual(['4002']);
    expect(centersChanged).toEqual(['CT-CQ-01']);
  });

  it('suporta os modos com e sem ação e preserva consultBlocked', () => {
    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';
    component.actionLabel = 'Consultar ordens';
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('po-button.contexto-producao__action'))).toBeTruthy();
    expect(component.actionDisabled).toBe(false);

    component.consultBlocked = true;
    expect(component.actionDisabled).toBe(true);

    fixture.componentRef.setInput('showAction', false);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('po-button.contexto-producao__action'))).toBeNull();
  });

  it('mantém campos visíveis e oferece retry durante erro', () => {
    component.errorMessage = 'Falha ao carregar o contexto.';
    component.loadingAction = true;
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('po-select')).length).toBe(2);
    expect(fixture.debugElement.query(By.css('[role="status"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[role="alert"]'))).toBeTruthy();
  });
});
