import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoButtonComponent, PoDialogService, PoNotificationService } from '@po-ui/ng-components';

import { PendingAuthorizedRoute } from '../../models/route-authorization.model';
import { RouteAuthorizationService } from '../../services/route-authorization.service';
import { RouteAnalysisSlide } from '../../components/route-analysis-slide/route-analysis-slide';
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

  it('abre a análise pelo p-click do PO UI sem depender de payload do evento', () => {
    fixture.detectChanges();
    const analysisSlideDebug = fixture.debugElement.query(By.directive(RouteAnalysisSlide));
    expect(analysisSlideDebug).not.toBeNull();
    const analysisSlide = analysisSlideDebug!.componentInstance as RouteAnalysisSlide;
    const open = vi.spyOn(analysisSlide, 'open').mockImplementation(() => undefined);
    component.routes.set([route(64382)]);
    component.state.set('ready');
    component.operationCode.set('10');
    fixture.detectChanges();
    const analysisButton = fixture.debugElement.query(By.css('.route-card__actions po-button'))
      .componentInstance as PoButtonComponent;

    expect(() => analysisButton.click.emit(null)).not.toThrow();

    expect(open).toHaveBeenCalledWith(route(64382), 10);
    fixture.detectChanges();
    expect(analysisButton.disabled).toBe(true);
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(service.finalize).not.toHaveBeenCalled();
  });

  it('usa a operação da consulta que retornou a ficha, mesmo após editar o filtro', () => {
    fixture.detectChanges();
    const analysisSlideDebug = fixture.debugElement.query(By.directive(RouteAnalysisSlide));
    expect(analysisSlideDebug).not.toBeNull();
    const analysisSlide = analysisSlideDebug!.componentInstance as RouteAnalysisSlide;
    const open = vi.spyOn(analysisSlide, 'open').mockImplementation(() => undefined);
    component.orderNumber.set('372562');
    component.operationCode.set('10');
    component.search();
    component.operationCode.set('20');

    component.requestAnalysis(route(64382));

    expect(open).toHaveBeenCalledWith(route(64382), 10);
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

  it('remove somente a ficha finalizada e restaura o foco real ao fechar a análise', async () => {
    fixture.detectChanges();
    const analysisSlideDebug = fixture.debugElement.query(By.directive(RouteAnalysisSlide));
    expect(analysisSlideDebug).not.toBeNull();
    const analysisSlide = analysisSlideDebug!.componentInstance as RouteAnalysisSlide;
    vi.spyOn(analysisSlide, 'open').mockImplementation(() => undefined);
    component.routes.set([route(64382), route(64442)]);
    component.state.set('ready');
    component.operationCode.set('10');
    fixture.detectChanges();
    const analysisButton = fixture.debugElement.query(By.css('.route-card__actions po-button'))
      .componentInstance as PoButtonComponent;
    const nativeButton = analysisButton.elementRef.nativeElement.querySelector('button') as HTMLButtonElement;

    analysisButton.click.emit(null);
    fixture.detectChanges();
    expect(nativeButton.disabled).toBe(true);
    const focusSink = document.createElement('button');
    document.body.append(focusSink);
    focusSink.focus();
    analysisSlide.routeFinalized.emit({
      sheetNumber: 64382, finalized: false, inspected: false,
      totalComponents: 1, savedComponents: 0, pendingComponents: 1,
      outOfRangeComponents: 1, statusCode: 2, message: 'Há componentes pendentes', exams: [],
    });
    expect(component.routes().map(item => item.sheetNumber)).toEqual([64382, 64442]);
    analysisSlide.analysisClosed.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(nativeButton);
    focusSink.remove();
    analysisSlide.routeFinalized.emit({
      sheetNumber: 64382, finalized: true, inspected: true,
      totalComponents: 1, savedComponents: 1, pendingComponents: 0,
      outOfRangeComponents: 1, statusCode: 4, message: 'Ficha finalizada', exams: [],
    });

    expect(component.routes().map(item => item.sheetNumber)).toEqual([64442]);
    expect(component.state()).toBe('ready');
    expect(component.feedback()).toBe('Ficha finalizada');
  });

  it('não tenta focar uma ficha removida após finalização bem-sucedida', async () => {
    fixture.detectChanges();
    const analysisSlide = fixture.debugElement.query(By.directive(RouteAnalysisSlide)).componentInstance as RouteAnalysisSlide;
    vi.spyOn(analysisSlide, 'open').mockImplementation(() => undefined);
    component.routes.set([route(64382)]);
    component.state.set('ready');
    component.operationCode.set('10');
    fixture.detectChanges();
    const analysisButton = fixture.debugElement.query(By.css('.route-card__actions po-button'))
      .componentInstance as PoButtonComponent;

    analysisButton.click.emit(null);
    analysisSlide.routeFinalized.emit({
      sheetNumber: 64382, finalized: true, inspected: true,
      totalComponents: 1, savedComponents: 1, pendingComponents: 0,
      outOfRangeComponents: 1, statusCode: 4, message: 'Ficha finalizada', exams: [],
    });
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.route-card__actions po-button'))).toBeNull();

    expect(() => analysisSlide.analysisClosed.emit()).not.toThrow();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.routes()).toEqual([]);
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
