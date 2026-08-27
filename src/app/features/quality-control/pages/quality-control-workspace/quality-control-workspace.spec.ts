import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { PoDialogService } from '@po-ui/ng-components';

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

  it('returns from a finalized route to the located order with its operation selected', () => {
    const fixture = TestBed.createComponent(QualityControlWorkspacePage);
    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const operation = {
      operationCode: '10',
      operationDescription: 'Cortar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca',
      processDescription: 'Corte',
    };
    const token = component.workflow.beginOrderLookup('325571');
    component.workflow.completeOrderLookup(token, '325571', [operation]);
    component.workflow.selectOperation(operation);
    component.workflow.setGeneratedRoute({
      routeNumber: '475.956',
      processDescription: 'Corte',
      currentOrder: '325571',
      operationCode: '10',
      operationDescription: '10 - Cortar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca',
    });
    component.workflow.completeRouteFinalization();

    component.goBack();

    expect(component.workflow.orderNumber()).toBe('325571');
    expect(component.workflow.operations()).toEqual([operation]);
    expect(component.workflow.selectedOperation()).toEqual(operation);
    expect(component.workflow.route()?.routeNumber).toBe('');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('exits the quality-control flow to the main menu', () => {
    const fixture = TestBed.createComponent(QualityControlWorkspacePage);
    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.workflow.updateOrderNumber('325571');

    component.exit();

    expect(component.workflow.orderNumber()).toBe('');
    expect(navigate).toHaveBeenCalledWith(['/menu']);
  });

  it('keeps navigation disabled and ignores it while a route is in progress', () => {
    const fixture = TestBed.createComponent(QualityControlWorkspacePage);
    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.workflow.setGeneratedRoute({
      routeNumber: '475.956',
      processDescription: 'Corte',
      currentOrder: '325571',
      operationCode: '10',
      operationDescription: '10 - Cortar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca',
    });
    fixture.detectChanges();

    const navigationButtons = fixture.debugElement.queryAll(
      By.css('.quality-workspace__actions po-button'),
    );
    expect(navigationButtons).toHaveLength(2);
    expect(navigationButtons.every(button => button.componentInstance.disabled)).toBe(true);

    component.goBack();
    component.exit();

    expect(component.workflow.route()?.routeNumber).toBe('475.956');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('enables navigation after the route finalization is registered', () => {
    const fixture = TestBed.createComponent(QualityControlWorkspacePage);
    const component = fixture.componentInstance;
    component.workflow.setGeneratedRoute({
      routeNumber: '475.956',
      processDescription: 'Corte',
      currentOrder: '325571',
      operationCode: '10',
      operationDescription: '10 - Cortar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca',
    });
    component.workflow.completeRouteFinalization();
    fixture.detectChanges();

    const navigationButtons = fixture.debugElement.queryAll(
      By.css('.quality-workspace__actions po-button'),
    );
    expect(navigationButtons.every(button => !button.componentInstance.disabled)).toBe(true);
  });

});
