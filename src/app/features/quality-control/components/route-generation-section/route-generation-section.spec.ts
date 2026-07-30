import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { PoDialogService } from '@po-ui/ng-components';

import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';
import { OperationalCommandFacade } from '../../../../core/offline/services/operational-command.facade';

import { RouteGenerationSection } from './route-generation-section';

describe('RouteGenerationSection', () => {
  let service: QualityControlService;
  let state: QualityControlWorkflowState;
  let component: RouteGenerationSection;
  let fixture: ComponentFixture<RouteGenerationSection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteGenerationSection],
      providers: [
        QualityControlWorkflowState,
        QualityControlService,
        {
          provide: OperationalCommandFacade,
          useValue: {
            capture: vi.fn(async (request: { idempotencyKey?: string }) => {
              const key = request.idempotencyKey ?? globalThis.crypto.randomUUID();
              return {
                localId: key,
                idempotencyKey: key,
                payloadHash: 'hash',
                committedAt: new Date().toISOString(),
                syncStatus: 'PENDING',
              };
            }),
          },
        },
        { provide: PoDialogService, useValue: { confirm: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RouteGenerationSection);
    component = fixture.componentInstance;
    service = TestBed.inject(QualityControlService);
    state = TestBed.inject(QualityControlWorkflowState);
  });

  it('keeps the brand without repeating the screen title', () => {
    fixture.detectChanges();
    const native = fixture.nativeElement as HTMLElement;
    const section = native.querySelector('section.route-generation');
    const logo = native.querySelector<HTMLImageElement>('.route-generation__brand img');

    expect(section?.getAttribute('aria-label')).toBe('Geração do roteiro de inspeção');
    expect(logo?.alt).toBe('Cortag — Revolution Tools');
    expect(native.textContent).not.toContain('Plano de Controle CQ');
    expect(native.textContent).toContain('Localização da Ordem');
  });

  it('generates inline and loads exams exactly once without router navigation', async () => {
    const loadSpy = vi.spyOn(service, 'getQualityExams');
    state.updateOrderNumber(' 325571 ');
    component.searchOrder();
    state.selectOperation(state.operations()[0]);

    component.generateRoute();
    component.generateRoute();

    await vi.waitFor(() => expect(state.route()?.routeNumber).toBe('475.956'));
    expect(state.exams().length).toBe(1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the generated route and enables a single explicit retry after exam load failure', async () => {
    const loadSpy = vi.spyOn(service, 'getQualityExams')
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of([]));
    state.updateOrderNumber('325571');
    component.searchOrder();
    state.selectOperation(state.operations()[0]);

    component.generateRoute();
    await vi.waitFor(() => expect(state.route()?.routeNumber).toBe('475.956'));
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
