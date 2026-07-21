import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  ProductionOrderOperation,
  ProductionOrderOperationsResult,
  ProductionOrderRoute,
} from '../../models/production-order-route';
import { QualityControlService } from '../../services/quality-control';

import { RouteGenerationPage } from './route-generation';

describe('RouteGenerationPage', () => {
  function operation(): ProductionOrderOperation {
    return {
      operationCode: '10',
      operationDescription: 'Cortar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca Master 75 OP10',
      processDescription: 'Corte de chapa',
    };
  }

  function operationsResult(operations = [operation()]): ProductionOrderOperationsResult {
    return {
      orderNumber: '325571',
      operations,
    };
  }

  function route(): ProductionOrderRoute {
    return {
      routeNumber: '475.956',
      processDescription: 'Corte de chapa',
      currentOrder: '325571',
      operationCode: '10',
      operationDescription: '10 - Cortar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca Master 75 OP10',
    };
  }

  function createComponent(
    qualityControlService: QualityControlService = new QualityControlService(),
    router = { navigate: vi.fn() },
  ): RouteGenerationPage {
    return new RouteGenerationPage(qualityControlService, router as never);
  }

  it('allows the order lookup with only the production order', () => {
    const component = createComponent();

    expect(component.canSearchOrder).toBe(false);

    component.orderNumber = '325571';

    expect(component.canSearchOrder).toBe(true);
    expect(component.canGenerateRoute).toBe(false);
  });

  it('loads linked operations and waits for an explicit selection', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'getProductionOrderOperations').mockReturnValue(
      of(operationsResult()),
    );
    const component = createComponent(qualityControlService);
    component.orderNumber = ' 325571 ';

    component.searchOrder();

    expect(qualityControlService.getProductionOrderOperations).toHaveBeenCalledWith('325571');
    expect(component.operations).toEqual([operation()]);
    expect(component.selectedOperation).toBeUndefined();
    expect(component.canGenerateRoute).toBe(false);
    expect(component.feedback).toBe(
      'Ordem localizada. Selecione uma operação para gerar o roteiro.',
    );
  });

  it('enables route generation after selecting a linked operation', () => {
    const component = createComponent();
    component.orderNumber = '325571';

    component.selectOperation(operation());

    expect(component.selectedOperation).toEqual(operation());
    expect(component.productionOrderRoute).toEqual({
      ...route(),
      routeNumber: '',
    });
    expect(component.canGenerateRoute).toBe(true);
  });

  it('clears a previous operation selection when the order changes', () => {
    const component = createComponent();
    component.orderNumber = '325571';
    component.operations = [operation()];
    component.selectOperation(operation());

    component.updateOrderNumber('325572');

    expect(component.operations).toEqual([]);
    expect(component.selectedOperation).toBeUndefined();
    expect(component.productionOrderRoute).toBeUndefined();
  });

  it('shows feedback when the order has no linked operations', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'getProductionOrderOperations').mockReturnValue(
      of(operationsResult([])),
    );
    const component = createComponent(qualityControlService);
    component.orderNumber = '325571';

    component.searchOrder();

    expect(component.operations).toEqual([]);
    expect(component.feedback).toBe('Nenhuma operação foi encontrada para esta Ordem.');
  });

  it('keeps the order number when the lookup fails', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'getProductionOrderOperations').mockReturnValue(
      throwError(() => new Error('offline')),
    );
    const component = createComponent(qualityControlService);
    component.orderNumber = '325571';

    component.searchOrder();

    expect(component.orderNumber).toBe('325571');
    expect(component.operations).toEqual([]);
    expect(component.selectedOperation).toBeUndefined();
    expect(component.feedback).toBe('Nao foi possivel consultar a Ordem no Datasul.');
  });

  it('generates the route from the selected operation and opens process inspection', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'generateInspectionRoute').mockReturnValue(of(route()));
    const router = { navigate: vi.fn() };
    const component = createComponent(qualityControlService, router);
    component.orderNumber = '325571';
    component.selectOperation(operation());
    component.moveBalance = true;

    component.generateRoute();

    expect(qualityControlService.generateInspectionRoute).toHaveBeenCalledWith({
      orderNumber: '325571',
      operation: operation(),
      moveBalance: true,
    });
    expect(router.navigate).toHaveBeenCalledWith(['/quality-control/inspection'], {
      state: { productionOrderRoute: route() },
    });
  });
});
