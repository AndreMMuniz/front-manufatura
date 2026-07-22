import { QualityExam } from '../models/quality-exam';
import { ProductionOrderRoute } from '../models/production-order-route';

import { QualityControlWorkflowState } from './quality-control-workflow-state';

describe('QualityControlWorkflowState', () => {
  const route: ProductionOrderRoute = {
    routeNumber: '475.956',
    processDescription: 'Corte',
    currentOrder: '325571',
    operationCode: '10',
    operationDescription: '10 - Cortar chapa',
    split: '1',
    itemCode: '30907',
    itemDescription: 'Alavanca',
  };

  function exams(): QualityExam[] {
    return [
      {
        id: 'exam-a', code: 'A', description: 'Primeiro', version: '1', frequency: '1', sample: '1 pc', unit: 'pc', nqa: '0', level: '1',
        components: [
          { id: 'a-20', code: '020', description: 'A20', reference: '0 - 20', minValue: 0, maxValue: 20, unit: 'mm', sequence: 20, status: 'PENDING' },
          { id: 'a-10', code: '010', description: 'A10', reference: '0 - 10', minValue: 0, maxValue: 10, unit: 'mm', sequence: 10, status: 'PENDING' },
        ],
      },
      {
        id: 'exam-b', code: 'B', description: 'Segundo', version: '1', frequency: '1', sample: '1 pc', unit: 'pc', nqa: '0', level: '1',
        components: [
          { id: 'b-10', code: '010', description: 'B10', reference: '0 - 10', minValue: 0, maxValue: 10, unit: 'mm', sequence: 10, status: 'PENDING' },
        ],
      },
    ];
  }

  function loadedState(): QualityControlWorkflowState {
    const state = new QualityControlWorkflowState();
    state.setGeneratedRoute(route);
    const token = state.beginExamLoad();
    expect(token).not.toBeNull();
    state.completeExamLoad(token!, exams());
    return state;
  }

  it('keeps Datasul exam order and sorts components only inside each exam', () => {
    const state = loadedState();

    expect(state.components().map(component => component.id)).toEqual(['a-10', 'a-20', 'b-10']);
    expect(state.selectedComponent()?.id).toBe('a-10');
    expect(state.selectedExam()?.id).toBe('exam-a');
  });

  it('allows one successful exam load per route and an explicit retry only after failure', () => {
    const state = new QualityControlWorkflowState();
    state.setGeneratedRoute(route);

    const firstToken = state.beginExamLoad();
    expect(state.beginExamLoad()).toBeNull();
    state.failExamLoad(firstToken!);

    const retryToken = state.beginExamLoad();
    expect(retryToken).not.toBeNull();
    state.completeExamLoad(retryToken!, exams());
    expect(state.beginExamLoad()).toBeNull();
  });

  it('ignores a late response from a discarded route context', () => {
    const state = new QualityControlWorkflowState();
    state.setGeneratedRoute(route);
    const staleToken = state.beginExamLoad();

    state.reset();
    state.completeExamLoad(staleToken!, exams());

    expect(state.route()).toBeUndefined();
    expect(state.exams()).toEqual([]);
  });

  it('computes dirty across all normalized drafts and clears only a saved draft', () => {
    const state = loadedState();
    state.updateDraft('a-10', { minimum: ' 1,0 ', maximum: '2.00', observation: ' ok ' });
    state.selectComponent('a-20');

    expect(state.isDirty()).toBe(true);

    state.applyMeasurement('exam-a', 'a-10', {
      minimum: 1,
      maximum: 2,
      observation: 'ok',
      status: 'APPROVED',
      operatorId: 'OP-001',
      savedAt: new Date('2026-07-22T10:00:00Z'),
    });

    expect(state.isDirty()).toBe(false);
    expect(state.componentById('a-10')?.status).toBe('APPROVED');
    expect(state.completedCount()).toBe(1);
  });

  it('updates exams immutably and isolates workspace instances', () => {
    const first = loadedState();
    const second = loadedState();
    const previousExams = first.exams();

    first.applyMeasurement('exam-a', 'a-10', {
      minimum: 1, maximum: 2, status: 'APPROVED', operatorId: 'OP-001', savedAt: new Date(),
    });

    expect(first.exams()).not.toBe(previousExams);
    expect(first.progressPercentage()).toBe(33);
    expect(second.progressPercentage()).toBe(0);
    expect(second.componentById('a-10')?.measurement).toBeUndefined();
  });

  it('synchronizes component and owning exam while navigating inside the panel', () => {
    const state = loadedState();
    state.openPanel('a-10');

    state.moveWithinExam(1);

    expect(state.selectedComponent()?.id).toBe('a-20');
    expect(state.selectedExam()?.id).toBe('exam-a');
    expect(state.panelOpen()).toBe(true);
  });
});
