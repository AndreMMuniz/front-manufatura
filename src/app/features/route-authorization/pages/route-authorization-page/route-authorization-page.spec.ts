import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoDialogService, PoNotificationService } from '@po-ui/ng-components';

import { PendingAuthorizedRoute } from '../../models/route-authorization.model';
import { RouteAuthorizationService } from '../../services/route-authorization.service';
import { RouteAuthorizationPage } from './route-authorization-page';

describe('RouteAuthorizationPage', () => {
  let fixture: ComponentFixture<RouteAuthorizationPage>;
  let component: RouteAuthorizationPage;
  let service: { search: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn> };
  let dialog: { confirm: ReturnType<typeof vi.fn> };
  let notification: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { search: vi.fn().mockReturnValue(of([route(64382)])), finalize: vi.fn() };
    dialog = { confirm: vi.fn() };
    notification = { success: vi.fn(), error: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [RouteAuthorizationPage],
      providers: [
        { provide: RouteAuthorizationService, useValue: service },
        { provide: PoDialogService, useValue: dialog },
        { provide: PoNotificationService, useValue: notification },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RouteAuthorizationPage);
    component = fixture.componentInstance;
    const actualDialog = (component as unknown as { dialog: PoDialogService }).dialog;
    dialog = { confirm: vi.spyOn(actualDialog, 'confirm').mockImplementation(() => undefined) };
  });

  it('mantém estado inicial até receber filtros válidos e exibe todas as fichas', () => {
    fixture.detectChanges();
    expect(component.state()).toBe('initial');

    component.orderNumber.set('372562');
    component.operationCode.set('10');
    component.search();

    expect(service.search).toHaveBeenCalledWith(372562, 10);
    expect(component.routes().map(item => item.sheetNumber)).toEqual([64382]);
    expect(component.state()).toBe('ready');
  });

  it('bloqueia consultas concorrentes enquanto a primeira está em andamento', () => {
    const first = new Subject<PendingAuthorizedRoute[]>();
    service.search.mockReturnValue(first);
    component.orderNumber.set('372562');
    component.operationCode.set('10');

    component.search();
    component.search();
    first.next([route(64382)]);

    expect(service.search).toHaveBeenCalledTimes(1);
    expect(component.routes().map(item => item.sheetNumber)).toEqual([64382]);
  });

  it('cancelar confirmação não finaliza e confirmar bloqueia envio concorrente', () => {
    const pending = new Subject<never>();
    service.finalize.mockReturnValue(pending);
    component.routes.set([route(64382)]);

    component.requestFinalization(route(64382));
    expect(service.finalize).not.toHaveBeenCalled();
    const options = dialog.confirm.mock.calls[0][0];
    options.confirm();
    options.confirm();

    expect(service.finalize).toHaveBeenCalledTimes(1);
    expect(component.finalizingSheet()).toBe(64382);
  });

  it('preserva filtros, descarta fichas antigas em falha e permite retry manual', () => {
    service.search.mockReturnValueOnce(throwError(() => new Error('network')))
      .mockReturnValueOnce(of([route(64382)]));
    component.orderNumber.set('372562');
    component.operationCode.set('10');
    component.routes.set([route(64442)]);

    component.search();
    expect(component.state()).toBe('error');
    expect(component.routes()).toEqual([]);
    expect(component.orderNumber()).toBe('372562');

    component.retry();
    expect(component.state()).toBe('ready');
  });

  it('não oferece retry operacional para filtros inválidos', () => {
    component.orderNumber.set('abc');
    component.operationCode.set('10');

    component.search();
    fixture.detectChanges();

    expect(component.state()).toBe('validation-error');
    expect(service.search).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Tentar novamente');
  });

  it('retira a ficha e preserva a mensagem quando a finalização tem sucesso', () => {
    service.finalize.mockReturnValue(of({
      sheetNumber: 64382, finalized: true, inspected: true,
      totalComponents: 1, savedComponents: 1, pendingComponents: 0,
      outOfRangeComponents: 1, statusCode: 4, message: 'Ficha finalizada', exams: [],
    }));
    component.routes.set([route(64382), route(64442)]);
    component.state.set('ready');

    component.requestFinalization(route(64382));
    dialog.confirm.mock.calls[0][0].confirm();

    expect(component.routes().map(item => item.sheetNumber)).toEqual([64442]);
    expect(component.state()).toBe('ready');
    expect(component.feedback()).toBe('Ficha finalizada');
    expect(notification.success).toHaveBeenCalledWith('Ficha finalizada');
  });

  it('mantém a ficha disponível e anuncia erro quando a finalização falha', () => {
    service.finalize.mockReturnValue(throwError(() => new Error('network')));
    component.routes.set([route(64382)]);
    component.state.set('ready');

    component.requestFinalization(route(64382));
    dialog.confirm.mock.calls[0][0].confirm();

    expect(component.routes().map(item => item.sheetNumber)).toEqual([64382]);
    expect(component.feedback()).toContain('Não foi possível finalizar');
    expect(notification.error).toHaveBeenCalled();
  });
});

function route(sheetNumber: number): PendingAuthorizedRoute {
  return {
    sheetNumber, productionOrderNumber: 372562, itemCode: '30907',
    itemDescription: 'ALAVANCA', operationSequence: 1, statusCode: 2,
    released: false, inspected: false, totalComponents: 4,
    outOfRangeComponents: 1, narrative: '',
  };
}
