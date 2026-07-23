import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { WorkCenter } from '../../../shop-floor/models/work-center';
import { AreaProducao } from '../../models/report-operacao.model';
import { ContextoProducaoCard } from './contexto-producao-card';

describe('ContextoProducaoCard', () => {
  let fixture: ComponentFixture<ContextoProducaoCard>;
  let component: ContextoProducaoCard;

  const areas: AreaProducao[] = [{ code: '4001', description: 'Produção' }];
  const centers: WorkCenter[] = [{
    code: 'CT-EXT-01',
    description: 'Extrusao Linha 01',
    areaCode: '4001',
    area: 'Producao',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  }];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ContextoProducaoCard] }).compileComponents();
    fixture = TestBed.createComponent(ContextoProducaoCard);
    component = fixture.componentInstance;
    component.areas = areas;
    component.centers = centers;
    fixture.detectChanges();
  });

  it('keeps work center and consultation disabled until the area and center are valid', () => {
    expect(component.centerDisabled).toBe(true);
    expect(component.consultDisabled).toBe(true);

    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';

    expect(component.centerDisabled).toBe(false);
    expect(component.consultDisabled).toBe(false);
  });

  it('keeps work center disabled while the options for the selected area are loading', () => {
    component.areaCode = '4001';
    component.loadingCenters = true;

    expect(component.centerDisabled).toBe(true);
    expect(component.consultDisabled).toBe(true);
  });

  it('emits typed changes without mutating inputs before the parent confirms them', () => {
    const areaChanges: string[] = [];
    const centerChanges: string[] = [];
    component.areaChange.subscribe(value => areaChanges.push(value));
    component.workCenterChange.subscribe(value => centerChanges.push(value));
    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';

    component.changeArea('4002');

    expect(component.areaCode).toBe('4001');
    expect(component.workCenterCode).toBe('CT-EXT-01');
    expect(areaChanges).toEqual(['4002']);

    component.changeWorkCenter('CT-CQ-01');

    expect(component.workCenterCode).toBe('CT-EXT-01');
    expect(centerChanges).toEqual(['CT-CQ-01']);
  });

  it('blocks consultation without blocking context controls during an active workflow', () => {
    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';
    component.consultBlocked = true;

    expect(component.centerDisabled).toBe(false);
    expect(component.consultDisabled).toBe(true);
  });

  it('keeps context fields rendered while a localized loading is active', () => {
    component.areaCode = '4001';
    component.workCenterCode = 'CT-EXT-01';
    component.loadingOrders = true;
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('po-select[name="areaCode"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('po-select[name="workCenterCode"]'))).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Consultando ordens');
  });

  it('renders the work centers received for the selected area as dropdown options', () => {
    component.areaCode = '4001';
    fixture.detectChanges();

    const workCenterSelect = fixture.debugElement.query(
      By.css('po-select[name="workCenterCode"]'),
    );

    expect(workCenterSelect).toBeTruthy();
    expect(component.centerOptions).toEqual([
      { value: 'CT-EXT-01', label: 'CT-EXT-01 - Extrusao Linha 01' },
    ]);
    expect(fixture.debugElement.query(By.css('po-combo[name="workCenterCode"]'))).toBeNull();
  });
});
