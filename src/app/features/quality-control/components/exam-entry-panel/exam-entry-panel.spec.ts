import { ComponentFixture, TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { PoDialogService } from '@po-ui/ng-components';

import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityExam } from '../../models/quality-exam';
import { OperatorService } from '../../../shop-floor/services/operator';
import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

import { ExamEntryPanel } from './exam-entry-panel';

describe('ExamEntryPanel', () => {
  let state: QualityControlWorkflowState;
  let service: QualityControlService;
  let component: ExamEntryPanel;
  let fixture: ComponentFixture<ExamEntryPanel>;
  const confirm = vi.fn();

  const route: ProductionOrderRoute = { routeNumber: '1', processDescription: 'P', currentOrder: '10', operationCode: '10', operationDescription: '10 - P', split: '1', itemCode: 'I', itemDescription: 'Item' };
  const exams: QualityExam[] = [
    { id: 'exam-a', code: 'A', description: 'A', version: '1', frequency: '1', sample: '1 pc', unit: 'pc', nqa: '0', level: '1', components: [
      { id: 'a-10', code: '010', description: 'A10', reference: '1 - 5', minValue: 1, maxValue: 5, unit: 'mm', sequence: 10, status: 'PENDING' },
      { id: 'a-20', code: '020', description: 'A20', reference: '1 - 5', minValue: 1, maxValue: 5, unit: 'mm', sequence: 20, status: 'PENDING' },
    ] },
    { id: 'exam-b', code: 'B', description: 'B', version: '1', frequency: '1', sample: '1 pc', unit: 'pc', nqa: '0', level: '1', components: [
      { id: 'b-10', code: '010', description: 'B10', reference: '10 - 20', measurementMethod: 'Paquímetro', minValue: 10, maxValue: 20, unit: 'mm', sequence: 10, status: 'PENDING' },
    ] },
  ];

  beforeEach(async () => {
    confirm.mockReset();
    await TestBed.configureTestingModule({
      imports: [ExamEntryPanel],
      providers: [
        QualityControlWorkflowState,
        QualityControlService,
        OperatorService,
        { provide: PoDialogService, useValue: { confirm } },
      ],
    }).compileComponents();
    state = TestBed.inject(QualityControlWorkflowState);
    service = TestBed.inject(QualityControlService);
    state.setGeneratedRoute(route);
    state.beginExamLoad();
    state.completeExamLoad(1, exams);
    state.openPanel('b-10');
    fixture = TestBed.createComponent(ExamEntryPanel);
    component = fixture.componentInstance;
  });

  it('shows the measurement method returned by the API in the characteristic card', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Meio de Medição');
    expect(fixture.nativeElement.textContent).toContain('Paquímetro');
  });

  it('uses the exam that owns the selected component and sanitizes numeric drafts', () => {
    component.updateMinimum('1x2,5mm');
    component.updateMaximum('20.0x');

    expect(component.exam?.id).toBe('exam-b');
    expect(component.minimum).toBe('12,5');
    expect(component.maximum).toBe('20.0');
    expect(state.isDirty()).toBe(true);
  });

  it('preserves out-of-range values and shows the exact error', async () => {
    component.updateMinimum('9');
    component.updateMaximum('20');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(component.errorTitle).toBe('Erro');
    expect(component.validationMessage).toBe('Valores fora da variação permitida');
    expect(component.minimum).toBe('9');
    expect(state.isComponentOutOfRange('b-10')).toBe(true);
  });

  it('clears the shared out-of-range status when the measurement is corrected', async () => {
    component.updateMinimum('9');
    component.updateMaximum('20');
    await firstValueFrom(component.saveCurrentMeasurement());

    component.updateMinimum('10');

    expect(state.isComponentOutOfRange('b-10')).toBe(false);
  });

  it('saves with the selected operator and updates the shared list immutably', async () => {
    await firstValueFrom(TestBed.inject(OperatorService).selectOperator('OP-001'));
    const saveSpy = vi.spyOn(service, 'saveMeasurement');
    component.updateMinimum('10');
    component.updateMaximum('20');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ examId: 'exam-b', componentId: 'b-10', operatorId: 'OP-001' }));
    expect(state.componentById('b-10')?.measurement?.minimum).toBe(10);
    expect(state.isDirty()).toBe(false);
  });

  it('retains the draft, selection and panel when save fails', async () => {
    vi.spyOn(service, 'saveMeasurement').mockReturnValue(throwError(() => new Error('offline')));
    component.updateMinimum('10');
    component.updateMaximum('20');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(component.minimum).toBe('10');
    expect(state.selectedComponentId()).toBe('b-10');
    expect(state.panelOpen()).toBe(true);
  });

  it('protects closing the panel when a non-current characteristic is dirty', () => {
    const dialog = (component as unknown as { dialog: PoDialogService }).dialog;
    const confirmSpy = vi.spyOn(dialog, 'confirm');
    state.updateDraft('a-10', { minimum: '1' });
    expect(state.isDirty()).toBe(true);

    component.closePanel();

    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fechar digitação?' }));
    expect(state.panelOpen()).toBe(true);
    confirmSpy.mock.calls[0][0].confirm?.();
    expect(state.panelOpen()).toBe(false);
    expect(state.isDirty()).toBe(false);
  });

  it('closes only after a successful exam completion and selects the next pending component', () => {
    state.applyMeasurement('exam-b', 'b-10', { minimum: 10, maximum: 20, status: 'APPROVED' });
    vi.spyOn(service, 'finishExam').mockReturnValue(of({ examId: 'exam-b', success: true, finishedAt: new Date() }));

    component.completeExam();

    expect(state.panelOpen()).toBe(false);
    expect(state.selectedComponentId()).toBe('a-10');
  });
});
