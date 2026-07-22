import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { PoDialogService } from '@po-ui/ng-components';

import { QualityExam } from '../../models/quality-exam';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

import { InspectionSection } from './inspection-section';

describe('InspectionSection', () => {
  let state: QualityControlWorkflowState;
  let component: InspectionSection;
  let fixture: ComponentFixture<InspectionSection>;
  const confirm = vi.fn();
  const exams: QualityExam[] = [{
    id: 'exam-a', code: 'A', description: 'A', version: '1', frequency: '120', sample: '1 pc', unit: 'pc', nqa: '0', level: '1', observation: 'Visual 100% do corte !',
    components: [
      { id: 'a-10', code: '010', description: 'A10', reference: '0 - 10', minValue: 0, maxValue: 10, unit: 'mm', sequence: 10, status: 'PENDING' },
      { id: 'a-20', code: '020', description: 'A20', reference: '0 - 20', minValue: 0, maxValue: 20, unit: 'mm', sequence: 20, status: 'PENDING' },
    ],
  }];

  beforeEach(async () => {
    confirm.mockReset();
    await TestBed.configureTestingModule({
      imports: [InspectionSection],
      providers: [QualityControlWorkflowState, { provide: PoDialogService, useValue: { confirm } }],
    }).compileComponents();
    state = TestBed.inject(QualityControlWorkflowState);
    state.setGeneratedRoute({ routeNumber: '1', processDescription: 'P', currentOrder: '10', operationCode: '10', operationDescription: 'P', split: '1', itemCode: 'I', itemDescription: 'Item' });
    const token = state.beginExamLoad()!;
    state.completeExamLoad(token, exams);
    fixture = TestBed.createComponent(InspectionSection);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens the selected characteristic inline without changing route context', () => {
    component.openExamEntry();

    expect(state.panelOpen()).toBe(true);
    expect(state.selectedExam()?.id).toBe('exam-a');
    expect(state.route()?.routeNumber).toBe('1');
  });

  it('shows the exam frequency as hours and minutes', () => {
    const frequency = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.inspection-process__exam-strip small'))
      .find(element => element.textContent?.includes('Frequência'));

    expect(frequency?.textContent).toContain('Frequência: 02:00 h');
  });

  it('shows the exam observation', () => {
    const observation = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.inspection-process__exam-strip small'))
      .find(element => element.textContent?.includes('Observação do Exame'));

    expect(observation?.textContent).toContain('Observação do Exame: Visual 100% do corte !');
  });

  it('shows a fallback when the exam observation is blank', () => {
    state.exams.update(current => current.map(exam => ({ ...exam, observation: '   ' })));
    fixture.detectChanges();

    const observation = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.inspection-process__exam-strip small'))
      .find(element => element.textContent?.includes('Observação do Exame'));

    expect(observation?.textContent).toContain('Observação do Exame: -');
  });

  it('blocks jumping over the next Datasul component', () => {
    component.selectComponent(state.componentById('a-20')!);

    expect(state.selectedComponentId()).toBe('a-10');
    expect(state.inspectionFeedback()).toBe('Siga a sequência do roteiro definida pelo Datasul.');
  });

  it('shows the out-of-range validation in the affected component status', () => {
    state.markComponentOutOfRange('a-10');
    fixture.detectChanges();

    const statuses = fixture.nativeElement.querySelectorAll('.inspection-process__component small');
    expect(statuses[0].textContent).toContain('Valores fora da variação permitida');
    expect(statuses[1].textContent).toContain('Pendente');
  });

  it('shows each approved component saved date and time in Brazilian format', () => {
    state.applyMeasurement('exam-a', 'a-10', {
      minimum: 1,
      maximum: 2,
      status: 'APPROVED',
      savedAt: new Date(2026, 6, 22, 14, 5),
    });
    state.applyMeasurement('exam-a', 'a-20', {
      minimum: 3,
      maximum: 4,
      status: 'APPROVED',
      savedAt: new Date(2026, 6, 22, 14, 17),
    });
    fixture.detectChanges();

    const statuses = fixture.nativeElement.querySelectorAll('.inspection-process__component-status');
    expect(statuses[0].textContent).toContain('Aprovado');
    expect(statuses[0].textContent).toContain('Mín: 1');
    expect(statuses[0].textContent).toContain('Máx: 2');
    expect(statuses[0].textContent).toContain('Apontado em 22/07/2026 14:05');
    expect(statuses[1].textContent).toContain('Mín: 3');
    expect(statuses[1].textContent).toContain('Máx: 4');
    expect(statuses[1].textContent).toContain('Apontado em 22/07/2026 14:17');
  });

  it('shows the saved minimum and maximum with Brazilian decimal separators', () => {
    state.applyMeasurement('exam-a', 'a-10', { minimum: 1.5, maximum: 2.75, status: 'APPROVED' });
    fixture.detectChanges();

    const components = fixture.nativeElement.querySelectorAll('.inspection-process__component');
    expect(components[0].textContent).toContain('Aprovado');
    expect(components[0].textContent).toContain('Mín: 1,5');
    expect(components[0].textContent).toContain('Máx: 2,75');
    expect(components[1].querySelector('.inspection-process__component-measurements')).toBeNull();
  });

  it('does not show an appointment time for a component without a saved date', () => {
    state.applyMeasurement('exam-a', 'a-10', { minimum: 1, maximum: 2, status: 'APPROVED' });
    fixture.detectChanges();

    const components = fixture.nativeElement.querySelectorAll('.inspection-process__component');
    expect(components[0].textContent).toContain('Aprovado');
    expect(components[0].querySelector('.inspection-process__component-time')).toBeNull();
    expect(components[1].querySelector('.inspection-process__component-time')).toBeNull();
  });

  it('asks PO-UI confirmation before discarding the current component draft', () => {
    state.applyMeasurement('exam-a', 'a-10', { minimum: 1, maximum: 2, status: 'APPROVED' });
    state.updateDraft('a-10', { observation: 'alterada' });

    component.selectComponent(state.componentById('a-20')!);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Trocar componente?' }));
    expect(state.selectedComponentId()).toBe('a-10');
    const confirmation = confirm.mock.calls[0][0];
    confirmation.confirm();
    expect(state.selectedComponentId()).toBe('a-20');
    expect(state.isComponentDirty('a-10')).toBe(false);
  });

  it('focuses the next selected component after exam completion', () => {
    component.restoreFocus('a-20');

    const buttons = fixture.nativeElement.querySelectorAll('.inspection-process__component');
    expect(document.activeElement).toBe(buttons[1]);
  });
});
