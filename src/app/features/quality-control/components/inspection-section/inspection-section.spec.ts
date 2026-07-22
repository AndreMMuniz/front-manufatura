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
    id: 'exam-a', code: 'A', description: 'A', version: '1', frequency: '1', sample: '1 pc', unit: 'pc', nqa: '0', level: '1',
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

  it('blocks jumping over the next Datasul component', () => {
    component.selectComponent(state.componentById('a-20')!);

    expect(state.selectedComponentId()).toBe('a-10');
    expect(state.inspectionFeedback()).toBe('Siga a sequência do roteiro definida pelo Datasul.');
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
