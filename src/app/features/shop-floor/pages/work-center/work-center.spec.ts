import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { Operator } from '../../models/operator';
import { OperationalContext } from '../../models/operational-context';
import { WorkCenter } from '../../models/work-center';
import { OperationalContextService } from '../../services/operational-context';
import { OperatorService } from '../../services/operator';
import { WorkCenterService } from '../../services/work-center';
import { WorkCenterPage } from './work-center';

describe('WorkCenterPage', () => {
  const centers: WorkCenter[] = [
    {
      code: 'CT-EXT-01',
      description: 'Extrusao Linha 01',
      area: 'Producao',
      machineGroup: 'Extrusoras',
      establishment: '101',
      active: true,
    },
    {
      code: 'CT-CQ-01',
      description: 'Controle de Qualidade',
      area: 'Qualidade',
      machineGroup: 'Qualidade',
      establishment: '101',
      active: true,
    },
    {
      code: 'CT-MNT-01',
      description: 'Manutencao',
      area: 'Apoio',
      machineGroup: 'Manutencao',
      establishment: '102',
      active: false,
    },
  ];
  const operators: Operator[] = [
    { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
    { code: 'OP-004', name: 'Diego Souza', role: 'Inspetor', active: false },
  ];

  let fixture: ComponentFixture<WorkCenterPage>;
  let component: WorkCenterPage;
  let routerMock: Router;
  let serviceMock: WorkCenterService;
  let operatorServiceMock: OperatorService;
  let contextServiceMock: OperationalContextService;

  beforeEach(async () => {
    routerMock = { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
    serviceMock = {
      listWorkCenters: vi.fn().mockReturnValue(of(centers)),
      selectWorkCenter: vi.fn((code: string) => of(centers.find(center => center.code === code && center.active) ?? null)),
      clearSelection: vi.fn(),
      selectedWorkCenter: null,
    } as unknown as WorkCenterService;
    operatorServiceMock = {
      selectOperator: vi.fn((code: string) => of(operators.find(operator => operator.code === code && operator.active) ?? null)),
      clearSelection: vi.fn(),
      selectedOperator: null,
    } as unknown as OperatorService;
    contextServiceMock = {
      setContext: vi.fn(),
      clearContext: vi.fn(),
      currentContext: null,
    } as unknown as OperationalContextService;

    await TestBed.configureTestingModule({
      imports: [WorkCenterPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: WorkCenterService, useValue: serviceMock },
        { provide: OperatorService, useValue: operatorServiceMock },
        { provide: OperationalContextService, useValue: contextServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkCenterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates with operator and actions blocked until a work center is valid', () => {
    expect(component).toBeTruthy();
    expect(component.canUseReportType).toBe(false);
    expect(component.canUseOperatorField).toBe(false);
    expect(component.canContinueToReport).toBe(false);
    expect(component.canContinueToInspection).toBe(false);
  });

  it('renders the operational fields and no local back button', () => {
    const native = fixture.nativeElement as HTMLElement;

    expect(native.textContent).toContain('Centro de Trabalho');
    expect(native.textContent).toContain('Reporte por');
    expect(native.textContent).toContain('Operador');
    expect(native.textContent).toContain('Validade');
    expect(native.textContent).toContain('Reporte');
    expect(native.textContent).toContain('Inspeção');
    expect(native.textContent).not.toContain('Voltar ao Menu');
  });

  it('validates an active work center and enables the operator field', () => {
    component.workCenterCode = 'CT-EXT-01';

    component.validateWorkCenter();

    expect(serviceMock.selectWorkCenter).toHaveBeenCalledWith('CT-EXT-01');
    expect(component.selectedWorkCenter).toEqual(centers[0]);
    expect(component.canUseOperatorField).toBe(true);
    expect(component.feedback).toBe('Centro de Trabalho carregado.');
  });

  it('validates the work center when the code field loses focus', () => {
    const validateSpy = vi.spyOn(component, 'validateWorkCenter');

    fixture.debugElement.query(By.css('po-input[name="workCenterCode"]')).triggerEventHandler('p-blur');

    expect(validateSpy).toHaveBeenCalled();
  });

  it('blocks continuation for an inactive or unknown work center', () => {
    component.workCenterCode = 'CT-MNT-01';

    component.validateWorkCenter();

    expect(component.selectedWorkCenter).toBeNull();
    expect(component.selectedOperator).toBeNull();
    expect(component.canContinueToReport).toBe(false);
    expect(component.feedback).toBe('Centro de Trabalho não encontrado.');
  });

  it('clears operator, validity and context when the work center changes', () => {
    component.selectedWorkCenter = centers[0];
    component.selectedOperator = operators[0];
    component.operatorCode = 'OP-001';
    component.reportType = 'BATCH';
    component.validity = '2026-06-30';

    component.onWorkCenterCodeChange('CT-CQ-01');

    expect(serviceMock.clearSelection).toHaveBeenCalled();
    expect(operatorServiceMock.clearSelection).toHaveBeenCalled();
    expect(contextServiceMock.clearContext).toHaveBeenCalled();
    expect(component.selectedWorkCenter).toBeNull();
    expect(component.selectedOperator).toBeNull();
    expect(component.reportType).toBe('OPERATOR');
    expect(component.validity).toBe('');
  });

  it('keeps equivalent work center code casing from clearing a valid selection', () => {
    component.selectedWorkCenter = centers[0];
    component.selectedOperator = operators[0];
    component.operatorCode = 'OP-001';
    component.validity = '2026-06-30';

    component.onWorkCenterCodeChange('ct-ext-01');

    expect(component.selectedWorkCenter).toEqual(centers[0]);
    expect(component.selectedOperator).toEqual(operators[0]);
    expect(component.validity).toBe('2026-06-30');
  });

  it('ignores stale work center validation responses after the code changes', () => {
    const result = new Subject<WorkCenter | null>();
    vi.mocked(serviceMock.selectWorkCenter).mockReturnValue(result.asObservable());
    component.workCenterCode = 'CT-EXT-01';

    component.validateWorkCenter();
    component.onWorkCenterCodeChange('CT-CQ-01');
    result.next(centers[0]);

    expect(component.selectedWorkCenter).toBeNull();
    expect(component.workCenterCode).toBe('CT-CQ-01');
    expect(component.isLoadingWorkCenter).toBe(false);
  });

  it('clears loading and dependent state when work center validation fails', () => {
    vi.mocked(serviceMock.selectWorkCenter).mockReturnValue(throwError(() => new Error('network')));
    component.selectedWorkCenter = centers[0];
    component.selectedOperator = operators[0];
    component.workCenterCode = 'CT-EXT-01';
    component.operatorCode = 'OP-001';
    component.validity = '2026-06-30';

    component.validateWorkCenter();

    expect(component.isLoadingWorkCenter).toBe(false);
    expect(component.selectedWorkCenter).toBeNull();
    expect(component.selectedOperator).toBeNull();
    expect(component.feedback).toBe('Não foi possível validar o Centro de Trabalho.');
  });

  it('clears stored context when report type changes', () => {
    component.selectedWorkCenter = centers[0];

    component.onReportTypeChange('BATCH');

    expect(component.reportType).toBe('BATCH');
    expect(contextServiceMock.clearContext).toHaveBeenCalled();
  });

  it('validates an active operator after a work center is selected', () => {
    component.selectedWorkCenter = centers[0];
    component.operatorCode = 'OP-001';

    component.validateOperator();

    expect(operatorServiceMock.selectOperator).toHaveBeenCalledWith('OP-001');
    expect(component.selectedOperator).toEqual(operators[0]);
    expect(component.feedback).toBe('Operador validado.');
  });

  it('validates the operator when the operator field loses focus', () => {
    const validateSpy = vi.spyOn(component, 'validateOperator');

    fixture.debugElement.query(By.css('po-input[name="operatorCode"]')).triggerEventHandler('p-blur');

    expect(validateSpy).toHaveBeenCalled();
  });

  it('blocks actions for an inactive or unknown operator', () => {
    component.selectedWorkCenter = centers[0];
    component.operatorCode = 'OP-004';

    component.validateOperator();

    expect(component.selectedOperator).toBeNull();
    expect(component.canContinueToReport).toBe(false);
    expect(component.feedback).toBe('Operador não encontrado ou inativo.');
  });

  it('ignores stale operator validation responses after the code changes', () => {
    const result = new Subject<Operator | null>();
    vi.mocked(operatorServiceMock.selectOperator).mockReturnValue(result.asObservable());
    component.selectedWorkCenter = centers[0];
    component.operatorCode = 'OP-001';

    component.validateOperator();
    component.onOperatorCodeChange('OP-002');
    result.next(operators[0]);

    expect(component.selectedOperator).toBeNull();
    expect(component.operatorCode).toBe('OP-002');
    expect(component.isLoadingOperator).toBe(false);
  });

  it('clears loading and operator state when operator validation fails', () => {
    vi.mocked(operatorServiceMock.selectOperator).mockReturnValue(throwError(() => new Error('network')));
    component.selectedWorkCenter = centers[0];
    component.selectedOperator = operators[0];
    component.operatorCode = 'OP-001';
    component.validity = '2026-06-30';

    component.validateOperator();

    expect(component.isLoadingOperator).toBe(false);
    expect(component.selectedOperator).toBeNull();
    expect(component.validity).toBe('');
    expect(component.feedback).toBe('Não foi possível validar o Operador.');
  });

  it('requires validity before enabling report and inspection', () => {
    component.selectedWorkCenter = centers[0];
    component.selectedOperator = operators[0];

    expect(component.canContinueToReport).toBe(false);

    component.onValidityChange('2026-06-30');

    expect(component.canContinueToReport).toBe(true);
    expect(component.canContinueToInspection).toBe(true);
  });

  it('stores operator report context and navigates to operation reporting', () => {
    component.selectedWorkCenter = centers[0];
    component.selectedOperator = operators[0];
    component.reportType = 'OPERATOR';
    component.validity = '2026-06-30';

    component.goToReport();

    expect(contextServiceMock.setContext).toHaveBeenCalledWith({
      workCenter: centers[0],
      operator: operators[0],
      reportType: 'OPERATOR',
      validity: '2026-06-30',
    } satisfies OperationalContext);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/operation-reporting']);
  });

  it('stores batch report context and navigates to operation reporting', () => {
    component.selectedWorkCenter = centers[0];
    component.selectedOperator = operators[0];
    component.reportType = 'BATCH';
    component.validity = '2026-06-30';

    component.goToReport();

    expect(contextServiceMock.setContext).toHaveBeenCalledWith(
      expect.objectContaining({
        reportType: 'BATCH',
      }),
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/operation-reporting']);
  });

  it('stores context and navigates to quality control for inspection', () => {
    component.selectedWorkCenter = centers[1];
    component.selectedOperator = operators[0];
    component.reportType = 'BATCH';
    component.validity = '2026-06-30';

    component.goToInspection();

    expect(contextServiceMock.setContext).toHaveBeenCalledWith(
      expect.objectContaining({
        workCenter: centers[1],
        reportType: 'BATCH',
      }),
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/quality-control']);
  });

  it('keeps scanner as a future placeholder without changing context', () => {
    component.showScannerUnavailable();

    expect(component.feedback).toBe('Leitura por scanner ainda não disponível.');
    expect(contextServiceMock.setContext).not.toHaveBeenCalled();
  });
});
