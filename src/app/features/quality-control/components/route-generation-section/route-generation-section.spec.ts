import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PoDialogService } from '@po-ui/ng-components';

import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';
import { RouteGenerationSection } from './route-generation-section';

describe('RouteGenerationSection', () => {
  let fixture: ComponentFixture<RouteGenerationSection>;
  let component: RouteGenerationSection;
  let state: QualityControlWorkflowState;
  const operation = { operationCode: '20', operationDescription: 'USINAR', split: '1',
    itemCode: '30907', itemDescription: '30907', processDescription: 'USINAR' };
  const exams = [{ id: '64379-1845', code: '1845', description: 'Exame', version: '1',
    frequency: '60', sample: '2', unit: '', nqa: '0', level: '0', components: [] }];
  const service = {
    getProductionOrderOperations: vi.fn(() => of({ orderNumber: '372562', operations: [operation] })),
    generateInspectionRoute: vi.fn(() => of({ nrFicha: 64379, routeNumber: '64379',
      processDescription: 'USINAR', currentOrder: '372562', operationCode: '20',
      operationDescription: '20 - USINAR', split: '1', itemCode: '30907', itemDescription: '30907', exams })),
    getQualityExams: vi.fn((route: { exams?: typeof exams }) => of(route.exams ?? [])),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({ imports: [RouteGenerationSection], providers: [
      QualityControlWorkflowState,
      { provide: QualityControlService, useValue: service },
      { provide: PoDialogService, useValue: { confirm: vi.fn() } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(RouteGenerationSection);
    component = fixture.componentInstance;
    state = TestBed.inject(QualityControlWorkflowState);
  });

  it('consulta, seleciona e carrega a ficha real sem navegação ou mock local', () => {
    state.updateOrderNumber('372562');
    component.searchOrder();
    state.selectOperation(state.operations()[0]);
    state.responsibleCode.set('00018060');
    component.generateRoute();
    expect(state.route()?.routeNumber).toBe('64379');
    expect(state.exams()).toEqual(exams);
    expect(service.generateInspectionRoute).toHaveBeenCalledTimes(1);
  });

  it('exige o código do operador padrão e o encaminha ao gerar o roteiro', () => {
    state.updateOrderNumber('372562');
    component.searchOrder();
    component.selectOperation(state.operations()[0]);
    fixture.detectChanges();

    const responsibleInput = fixture.debugElement.query(By.css('po-input[name="responsibleCode"]'));
    expect(responsibleInput).toBeTruthy();
    expect(responsibleInput.componentInstance.label).toBe('Operador');
    expect(component.canGenerateRoute).toBe(false);

    responsibleInput.triggerEventHandler('ngModelChange', ' 00018060 ');
    fixture.detectChanges();
    expect(component.canGenerateRoute).toBe(true);

    component.generateRoute();
    expect(service.generateInspectionRoute).toHaveBeenCalledWith(expect.objectContaining({
      responsibleType: 'OPERADOR',
      responsibleCode: '00018060',
    }));
  });

  it('altera o label e o tipo enviado quando a operação for de equipe', () => {
    const teamOperation = { ...operation, responsibleType: 'EQUIPE' as const };
    const token = state.beginOrderLookup('372562');
    state.completeOrderLookup(token, '372562', [teamOperation]);
    component.selectOperation(teamOperation);
    fixture.detectChanges();

    const responsibleInput = fixture.debugElement.query(By.css('po-input[name="responsibleCode"]'));
    expect(responsibleInput.componentInstance.label).toBe('Equipe');

    responsibleInput.triggerEventHandler('ngModelChange', ' AUT00037 ');
    component.generateRoute();
    expect(service.generateInspectionRoute).toHaveBeenCalledWith(expect.objectContaining({
      responsibleType: 'EQUIPE',
      responsibleCode: 'AUT00037',
    }));
  });

  it('não injeta OP fictícia ao acionar scanner sem integração', () => {
    component.scanOrder();
    expect(state.orderNumber()).toBe('');
    expect(state.routeFeedback()).toContain('não está configurada');
  });
});
