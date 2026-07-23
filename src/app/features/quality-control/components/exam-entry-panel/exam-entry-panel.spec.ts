import { ComponentFixture, TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { PoDialogService } from '@po-ui/ng-components';

import { SaveMeasurementResponse } from '../../models/inspection-record';
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

  it('shows the requested title in the measurement widget', () => {
    fixture.detectChanges();

    const measurementWidget = fixture.nativeElement.querySelectorAll('po-widget')[1] as HTMLElement;

    expect(measurementWidget.querySelector('.po-widget-text')?.textContent?.trim()).toBe('Status/Medidas encontradas');
  });

  it('uses the exam that owns the selected component and sanitizes numeric drafts', () => {
    component.updateMinimum('1x2,5mm');
    component.updateMaximum('20.0x');

    expect(component.exam?.id).toBe('exam-b');
    expect(component.minimum).toBe('12,5');
    expect(component.maximum).toBe('20.0');
    expect(state.isDirty()).toBe(true);
  });

  it('saves out-of-range values as rejected, shows the warning and locks the measurement', async () => {
    const saveSpy = vi.spyOn(service, 'saveMeasurement');
    component.updateMinimum('9');
    component.updateMaximum('20');

    await firstValueFrom(component.saveCurrentMeasurement());

    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('.exam-entry__alert') as HTMLElement;
    expect(component.hasOutOfRangeAlert).toBe(true);
    expect(component.outOfRangeMessage).toBe('Valores fora da variação permitida');
    expect(alert.textContent?.trim()).toBe('Valores fora da variação permitida');
    expect(alert.querySelector('po-icon')?.getAttribute('p-icon')).toBe('an an-warning');
    expect(component.minimum).toBe('9');
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      componentId: 'b-10',
      measurement: expect.objectContaining({ minimum: 9, maximum: 20, status: 'REJECTED' }),
    }));
    expect(state.componentById('b-10')?.measurement?.status).toBe('REJECTED');
    expect(state.componentById('b-10')?.measurement?.savedAt).toBeInstanceOf(Date);
    expect(state.isComponentOutOfRange('b-10')).toBe(true);
    expect(state.completedCount()).toBe(1);
    expect(component.isCurrentMeasurementLocked).toBe(true);
    expect(state.isDirty()).toBe(false);
    expect(state.panelOpen()).toBe(true);
  });

  it('advances after a rejected save without leaking its warning to the next characteristic', async () => {
    state.openPanel('a-10');
    component.updateMinimum('0');
    component.updateMaximum('5');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(state.componentById('a-10')?.measurement?.status).toBe('REJECTED');
    expect(state.selectedComponentId()).toBe('a-20');
    expect(component.hasOutOfRangeAlert).toBe(false);
    expect(component.validationMessage).toBe('');

    component.goPrevious();

    expect(state.selectedComponentId()).toBe('a-10');
    expect(component.hasOutOfRangeAlert).toBe(true);
    expect(component.outOfRangeMessage).toBe('Valores fora da variação permitida');
  });

  it('does not allow the operator to change or resend a confirmed rejected measurement', async () => {
    const saveSpy = vi.spyOn(service, 'saveMeasurement');
    state.applyMeasurement('exam-b', 'b-10', {
      minimum: 9,
      maximum: 20,
      observation: 'aguarda supervisor',
      status: 'REJECTED',
      savedAt: new Date(),
    });

    component.updateMinimum('10');
    component.updateMaximum('19');
    component.observation = 'alterada';
    await firstValueFrom(component.saveCurrentMeasurement());

    expect(component.minimum).toBe('9');
    expect(component.maximum).toBe('20');
    expect(component.observation).toBe('aguarda supervisor');
    expect(saveSpy).not.toHaveBeenCalled();
    expect(component.hasOutOfRangeAlert).toBe(true);
  });

  it('keeps structurally invalid values editable and does not call the API', async () => {
    const saveSpy = vi.spyOn(service, 'saveMeasurement');
    component.updateMinimum('20');
    component.updateMaximum('10');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(saveSpy).not.toHaveBeenCalled();
    expect(component.validationMessage).toBe('Min deve ser menor ou igual ao Max.');
    expect(component.isCurrentMeasurementLocked).toBe(false);
    expect(state.completedCount()).toBe(0);
  });

  it('requires both minimum and maximum before calling the API', async () => {
    const saveSpy = vi.spyOn(service, 'saveMeasurement');
    component.updateMinimum('10');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(saveSpy).not.toHaveBeenCalled();
    expect(component.validationMessage).toBe('Informe valores numéricos para Min e Max.');
    expect(state.selectedComponentId()).toBe('b-10');
    expect(component.isCurrentMeasurementLocked).toBe(false);
  });

  it('retains an out-of-range draft and keeps it editable when the API fails', async () => {
    vi.spyOn(service, 'saveMeasurement').mockReturnValue(throwError(() => new Error('offline')));
    component.updateMinimum('9');
    component.updateMaximum('20');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(component.minimum).toBe('9');
    expect(component.maximum).toBe('20');
    expect(component.hasOutOfRangeAlert).toBe(true);
    expect(component.isCurrentMeasurementLocked).toBe(false);
    expect(state.componentById('b-10')?.measurement).toBeUndefined();
    expect(state.completedCount()).toBe(0);
  });

  it('allows completing an exam when all measurements are saved with mixed results', () => {
    state.openPanel('a-10');
    state.applyMeasurement('exam-a', 'a-10', {
      minimum: 0,
      maximum: 5,
      status: 'REJECTED',
      savedAt: new Date(),
    });
    state.applyMeasurement('exam-a', 'a-20', {
      minimum: 1,
      maximum: 5,
      status: 'APPROVED',
      savedAt: new Date(),
    });

    expect(component.completedCount).toBe(2);
    expect(component.progressPercentage).toBe(100);
    expect(component.canCompleteExam).toBe(true);
  });

  it('saves with the selected operator and updates the shared list immutably', async () => {
    await firstValueFrom(TestBed.inject(OperatorService).selectOperator('OP-001'));
    const saveSpy = vi.spyOn(service, 'saveMeasurement');
    component.updateMinimum('10');
    component.updateMaximum('20');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ examId: 'exam-b', componentId: 'b-10', operatorId: 'OP-001' }));
    expect(state.componentById('b-10')?.measurement?.minimum).toBe(10);
    expect(state.componentById('b-10')?.measurement?.savedAt).toBeInstanceOf(Date);
    expect(state.isDirty()).toBe(false);
    expect(state.selectedComponentId()).toBe('b-10');
    expect(state.panelOpen()).toBe(true);

    fixture.detectChanges();
    const actionButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.exam-entry__navigation po-button'),
    ) as HTMLElement[];
    const saveButton = actionButtons
      .find(button => button.textContent?.trim() === 'Salvar')
      ?.querySelector('button') as HTMLButtonElement | undefined;
    expect(saveButton?.disabled).toBe(true);
  });

  it('advances to the next characteristic only after the API confirms the save', () => {
    const response = new Subject<SaveMeasurementResponse>();
    vi.spyOn(service, 'saveMeasurement').mockReturnValue(response);
    state.openPanel('a-10');
    component.updateMinimum('1');
    component.updateMaximum('5');

    component.saveCurrentMeasurement().subscribe();

    expect(state.selectedComponentId()).toBe('a-10');
    expect(state.componentById('a-10')?.measurement).toBeUndefined();
    expect(state.isSaving()).toBe(true);

    response.next({
      componentId: 'a-10',
      measurement: {
        minimum: 1,
        maximum: 5,
        status: 'APPROVED',
        savedAt: new Date(),
      },
    });
    response.complete();

    expect(state.componentById('a-10')?.measurement?.minimum).toBe(1);
    expect(state.selectedComponentId()).toBe('a-20');
    expect(state.isSaving()).toBe(false);
    expect(state.isDirty()).toBe(false);
  });

  it('advances from the last characteristic of one exam to the next pending exam', async () => {
    state.openPanel('a-20');
    component.updateMinimum('1');
    component.updateMaximum('5');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(state.componentById('a-20')?.measurement?.status).toBe('APPROVED');
    expect(state.selectedComponentId()).toBe('b-10');
    expect(component.exam?.id).toBe('exam-b');
    expect(state.panelOpen()).toBe(true);
  });

  it('retains the draft, selection and panel when save fails', async () => {
    vi.spyOn(service, 'saveMeasurement').mockReturnValue(throwError(() => new Error('offline')));
    state.openPanel('a-10');
    component.updateMinimum('1');
    component.updateMaximum('5');

    await firstValueFrom(component.saveCurrentMeasurement());

    expect(component.minimum).toBe('1');
    expect(component.maximum).toBe('5');
    expect(state.selectedComponentId()).toBe('a-10');
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
