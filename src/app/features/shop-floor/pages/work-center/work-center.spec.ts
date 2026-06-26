import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkCenter } from '../../models/work-center';
import { WorkCenterService } from '../../services/work-center';
import { WorkCenterPage } from './work-center';

describe('WorkCenterPage', () => {
  const centers: WorkCenter[] = [
    { code: 'CT-EXT-01', description: 'Extrusao Linha 01', area: 'Producao', active: true },
    { code: 'CT-CQ-01', description: 'Controle de Qualidade', area: 'Qualidade', active: true },
    { code: 'CT-MNT-01', description: 'Manutencao', area: 'Apoio', active: false },
  ];

  let fixture: ComponentFixture<WorkCenterPage>;
  let component: WorkCenterPage;
  let routerMock: Router;
  let serviceMock: WorkCenterService;

  beforeEach(async () => {
    routerMock = { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
    serviceMock = {
      listWorkCenters: vi.fn().mockReturnValue(of(centers)),
      searchWorkCenters: vi.fn((term: string) =>
        of(centers.filter(center => `${center.code} ${center.description}`.toLowerCase().includes(term.toLowerCase()))),
      ),
      selectWorkCenter: vi.fn((code: string) => of(centers.find(center => center.code === code && center.active) ?? null)),
      clearSelection: vi.fn(),
      selectedWorkCenter: null,
    } as unknown as WorkCenterService;

    await TestBed.configureTestingModule({
      imports: [WorkCenterPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: WorkCenterService, useValue: serviceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkCenterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and loads the initial work center list', () => {
    expect(component).toBeTruthy();
    expect(serviceMock.listWorkCenters).toHaveBeenCalled();
    expect(component.workCenters).toEqual(centers);
  });

  it('filters work centers by the current search term', () => {
    component.searchTerm = 'cq';

    component.search();

    expect(serviceMock.searchWorkCenters).toHaveBeenCalledWith('cq');
    expect(component.workCenters).toEqual([centers[1]]);
  });

  it('selects an active work center and shows the selection summary', () => {
    component.selectWorkCenter(centers[0]);

    expect(serviceMock.selectWorkCenter).toHaveBeenCalledWith('CT-EXT-01');
    expect(component.selectedWorkCenter).toEqual(centers[0]);
  });

  it('does not select inactive work centers', () => {
    component.selectWorkCenter(centers[2]);

    expect(component.selectedWorkCenter).toBeNull();
  });

  it('clears the current work center selection', () => {
    component.selectedWorkCenter = centers[1];

    component.clearSelection();

    expect(serviceMock.clearSelection).toHaveBeenCalled();
    expect(component.selectedWorkCenter).toBeNull();
  });

  it('navigates back to the main menu', () => {
    component.backToMenu();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/menu']);
  });

  it('renders work center status and selected context', () => {
    component.selectedWorkCenter = centers[0];
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    expect(native.textContent).toContain('CT-EXT-01');
    expect(native.textContent).toContain('Ativo');
    expect(native.textContent).toContain('Centro selecionado');
  });
});
