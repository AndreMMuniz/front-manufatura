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
    state.updateDraft('a-10', { result: ' 1,0 ', observation: ' ok ' });
    state.selectComponent('a-20');

    expect(state.isDirty()).toBe(true);

    state.applyMeasurement('exam-a', 'a-10', {
      result: 1,
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
      result: 1, status: 'APPROVED', operatorId: 'OP-001', savedAt: new Date(),
    });

    expect(first.exams()).not.toBe(previousExams);
    expect(first.progressPercentage()).toBe(33);
    expect(second.progressPercentage()).toBe(0);
    expect(second.componentById('a-10')?.measurement).toBeUndefined();
  });

  it('counts a remotely rejected result as completed and continues with the next pending component', () => {
    const state = loadedState();
    state.applyMeasurement('exam-a', 'a-10', {
      result: -1,
      status: 'REJECTED',
      deliveryStatus: 'SYNCED',
      withinRange: false,
      operatorId: 'OP-001',
      savedAt: new Date(),
    });

    expect(state.componentById('a-10')?.status).toBe('REJECTED');
    expect(state.completedCount()).toBe(1);
    expect(state.pendingCount()).toBe(2);
    expect(state.progressPercentage()).toBe(33);
    expect(state.isComponentOutOfRange('a-10')).toBe(true);

    state.selectNextPendingAndClose();

    expect(state.selectedComponentId()).toBe('a-20');
  });

  it('synchronizes component and owning exam while navigating inside the panel', () => {
    const state = loadedState();
    state.openPanel('a-10');

    state.moveWithinExam(1);

    expect(state.selectedComponent()?.id).toBe('a-20');
    expect(state.selectedExam()?.id).toBe('exam-a');
    expect(state.panelOpen()).toBe(true);
  });

  it('moves to the next pending component across exams and skips completed components', () => {
    const state = loadedState();
    state.applyMeasurement('exam-a', 'a-20', {
      result: 1, status: 'APPROVED', operatorId: 'OP-001', savedAt: new Date(),
    });
    state.openPanel('a-10');

    state.moveToNextPending('a-10');

    expect(state.selectedComponentId()).toBe('b-10');
    expect(state.selectedExam()?.id).toBe('exam-b');
    expect(state.panelOpen()).toBe(true);
  });

  it('keeps the saved component selected when there is no later pending component', () => {
    const state = loadedState();
    state.openPanel('b-10');
    state.applyMeasurement('exam-b', 'b-10', {
      result: 1, status: 'APPROVED', operatorId: 'OP-001', savedAt: new Date(),
    });

    state.moveToNextPending('b-10');

    expect(state.selectedComponentId()).toBe('b-10');
    expect(state.panelOpen()).toBe(true);
  });

  it('tracks out-of-range validation per component and clears it after approval', () => {
    const state = loadedState();
    state.markComponentOutOfRange('a-10');

    expect(state.isComponentOutOfRange('a-10')).toBe(true);
    expect(state.isComponentOutOfRange('a-20')).toBe(false);

    state.applyMeasurement('exam-a', 'a-10', {
      result: 1, status: 'APPROVED', operatorId: 'OP-001', savedAt: new Date(),
    });

    expect(state.isComponentOutOfRange('a-10')).toBe(false);
  });

  it('clears a stopped route while preserving the selected order and operation context', () => {
    const state = new QualityControlWorkflowState();
    const operation = {
      operationCode: route.operationCode,
      operationDescription: 'Cortar chapa',
      split: route.split,
      itemCode: route.itemCode,
      itemDescription: route.itemDescription,
      processDescription: route.processDescription,
    };
    const token = state.beginOrderLookup(route.currentOrder);
    state.completeOrderLookup(token, route.currentOrder, [operation]);
    state.selectOperation(operation);
    state.setGeneratedRoute(route);
    const examToken = state.beginExamLoad();
    state.completeExamLoad(examToken!, exams());
    state.isStopping.set(true);

    state.completeRouteStop();

    expect(state.orderNumber()).toBe(route.currentOrder);
    expect(state.selectedOperation()).toEqual(operation);
    expect(state.route()).toBeUndefined();
    expect(state.exams()).toEqual([]);
    expect(state.panelOpen()).toBe(false);
    expect(state.isStopping()).toBe(false);
    expect(state.isBusy()).toBe(false);
    expect(state.routeFeedback()).toContain('Roteiro parado');
  });
});
