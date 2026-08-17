import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { WorkCenter } from '../../models/work-center';
import { RecentProductionContext } from '../../services/recent-production-context.service';
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

    expect(fixture.debugElement.query(By.css('po-input[name="areaCode"]'))).toBeTruthy();
    expect(fixture.debugElement.queryAll(By.css('po-select'))).toHaveLength(1);
    expect(fixture.debugElement.query(By.css('[role="status"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[role="alert"]'))).toBeTruthy();
  });

  it('recebe a Área de Produção por digitação e mantém o Centro como seleção', () => {
    const areaInput = fixture.debugElement.query(By.css('po-input[name="areaCode"]'));

    expect(areaInput).toBeTruthy();
    expect(fixture.debugElement.queryAll(By.css('po-select'))).toHaveLength(1);
  });

  it('solicita a validação da Área ao sair do campo', () => {
    const values: string[] = [];
    component.areaCode = ' 4104 ';
    component.areaValidate.subscribe(value => values.push(value));
    fixture.detectChanges();

    fixture.debugElement.query(By.css('po-input[name="areaCode"]')).triggerEventHandler('p-blur');

    expect(values).toEqual([' 4104 ']);
  });

  it('mostra os contextos recentes e emite a escolha sem aceitá-la localmente', () => {
    const recent: RecentProductionContext = {
      areaCode: '4104', workCenterCode: 'BAN-012-01',
      workCenterDescription: 'Bancada', lastUsedAt: '2026-08-17T12:00:00.000Z',
    };
    component.recentContexts = [recent];
    const selected: RecentProductionContext[] = [];
    component.recentContextSelect.subscribe(value => selected.push(value));
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('.contexto-producao__recent-button'));
    expect(button.nativeElement.textContent).toContain('4104');
    expect(button.nativeElement.textContent).toContain('BAN-012-01');
    button.triggerEventHandler('click');

    expect(selected).toEqual([recent]);
  });
});
