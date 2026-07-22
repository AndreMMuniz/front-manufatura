import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { PoDialogService } from '@po-ui/ng-components';

import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

import { RouteGenerationSection } from './route-generation-section';

describe('RouteGenerationSection', () => {
  let service: QualityControlService;
  let state: QualityControlWorkflowState;
  let component: RouteGenerationSection;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteGenerationSection],
      providers: [
        QualityControlWorkflowState,
        QualityControlService,
        { provide: PoDialogService, useValue: { confirm: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(RouteGenerationSection);
    component = fixture.componentInstance;
    service = TestBed.inject(QualityControlService);
    state = TestBed.inject(QualityControlWorkflowState);
  });

  it('generates inline and loads exams exactly once without router navigation', () => {
    const loadSpy = vi.spyOn(service, 'getQualityExams');
    state.updateOrderNumber(' 325571 ');
    component.searchOrder();
    state.selectOperation(state.operations()[0]);

    component.generateRoute();
    component.generateRoute();

    expect(state.route()?.routeNumber).toBe('475.956');
    expect(state.exams().length).toBe(1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the generated route and enables a single explicit retry after exam load failure', () => {
    const loadSpy = vi.spyOn(service, 'getQualityExams')
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of([]));
    state.updateOrderNumber('325571');
    component.searchOrder();
    state.selectOperation(state.operations()[0]);

    component.generateRoute();
    expect(state.route()?.routeNumber).toBe('475.956');
    expect(state.examLoadFailed()).toBe(true);

    component.retryExamLoad();
    component.retryExamLoad();
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it('ignores an obsolete order lookup response after the order changes', () => {
    const response = new Subject<ReturnType<typeof state.completeOrderLookup> extends never ? never : { orderNumber: string; operations: [] }>();
    vi.spyOn(service, 'getProductionOrderOperations').mockReturnValue(response);
    state.updateOrderNumber('100');
    component.searchOrder();

    state.updateOrderNumber('200');
    response.next({ orderNumber: '100', operations: [] });

    expect(state.orderNumber()).toBe('200');
  });
});
