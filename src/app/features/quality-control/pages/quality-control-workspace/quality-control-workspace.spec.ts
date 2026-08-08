import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { PoDialogService } from '@po-ui/ng-components';

import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

import { QualityControlWorkspacePage } from './quality-control-workspace';

describe('QualityControlWorkspacePage', () => {
  const confirm = vi.fn();

  beforeEach(async () => {
    confirm.mockReset();
    await TestBed.configureTestingModule({
      imports: [QualityControlWorkspacePage],
      providers: [provideRouter([]), { provide: PoDialogService, useValue: { confirm } }],
    }).compileComponents();
  });

  it('reveals inspection and exam entry progressively in one component tree', () => {
    const fixture = TestBed.createComponent(QualityControlWorkspacePage);
    const state = fixture.componentInstance.workflow;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-route-generation-section')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-inspection-section')).toBeFalsy();

    state.setGeneratedRoute({ routeNumber: '1', processDescription: 'P', currentOrder: '10', operationCode: '10', operationDescription: 'P', split: '1', itemCode: 'I', itemDescription: 'Item' });
    const token = state.beginExamLoad()!;
    state.completeExamLoad(token, [{
      id: 'exam', code: 'E', description: 'E', version: '1', frequency: '1', sample: '1 pc', unit: 'pc', nqa: '0', level: '1',
      components: [{ id: 'c', code: '010', description: 'C', reference: '0 - 1', minValue: 0, maxValue: 1, unit: 'mm', sequence: 10, status: 'PENDING' }],
    }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-inspection-section')).toBeTruthy();

    state.openPanel('c');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-inspection-section')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-exam-entry-panel')).toBeTruthy();
  });

  it('returns to work-center and exit resets while staying in the CQ route', () => {
    const fixture = TestBed.createComponent(QualityControlWorkspacePage);
    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.workflow.updateOrderNumber('325571');

    component.exit();
    expect(component.workflow.orderNumber()).toBe('');
    expect(navigate).not.toHaveBeenCalled();

    component.goBack();
    expect(navigate).toHaveBeenCalledWith(['/work-center']);
  });

  it('protects workspace exit when any non-current draft is dirty', () => {
    const fixture = TestBed.createComponent(QualityControlWorkspacePage);
    const dialog = (fixture.componentInstance as unknown as { dialog: PoDialogService }).dialog;
    const confirmSpy = vi.spyOn(dialog, 'confirm');
    const state: QualityControlWorkflowState = fixture.componentInstance.workflow;
    state.setGeneratedRoute({ routeNumber: '1', processDescription: 'P', currentOrder: '10', operationCode: '10', operationDescription: 'P', split: '1', itemCode: 'I', itemDescription: 'Item' });
    const token = state.beginExamLoad()!;
    state.completeExamLoad(token, [{
      id: 'exam', code: 'E', description: 'E', version: '1', frequency: '1', sample: '1 pc', unit: 'pc', nqa: '0', level: '1',
      components: [
        { id: 'c1', code: '010', description: 'C1', reference: '0 - 1', minValue: 0, maxValue: 1, unit: 'mm', sequence: 10, status: 'PENDING' },
        { id: 'c2', code: '020', description: 'C2', reference: '0 - 1', minValue: 0, maxValue: 1, unit: 'mm', sequence: 20, status: 'PENDING' },
      ],
    }]);
    state.updateDraft('c2', { result: '0' });
    expect(state.isDirty()).toBe(true);
    expect(state.isBusy()).toBe(false);

    fixture.componentInstance.exit();

    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sair do Plano Controle CQ?' }));
    expect(state.route()?.routeNumber).toBe('1');
  });
});
