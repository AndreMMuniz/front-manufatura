import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityControlService } from '../../services/quality-control';

import { RouteGenerationPage } from './route-generation';

describe('RouteGenerationPage', () => {
  function route(): ProductionOrderRoute {
    return {
      routeNumber: '475.956',
      processDescription: '10 - Extrusao',
      currentOrder: '372635',
      operationCode: '10',
      operationDescription: '10 - Extrusao',
      split: '1',
      itemCode: '61035',
      itemDescription: 'Espacador Cunha 1,5mm',
    };
  }

  function createComponent(
    qualityControlService: QualityControlService = new QualityControlService(),
    router = { navigate: vi.fn() },
  ): RouteGenerationPage {
    return new RouteGenerationPage(qualityControlService, router as never);
  }

  it('blocks route generation until the production order is located', () => {
    const component = createComponent();
    component.orderNumber = '372635';
    component.opNumber = '10';
    component.split = '1';

    expect(component.canGenerateRoute).toBe(false);
  });

  it('locates the production order and enables route generation', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'getProductionOrderRoute').mockReturnValue(of(route()));
    const component = createComponent(qualityControlService);
    component.orderNumber = '372635';
    component.opNumber = '10';
    component.split = '1';

    component.searchOrder();

    expect(qualityControlService.getProductionOrderRoute).toHaveBeenCalledWith({
      opNumber: '372635',
      operationCode: '10',
      split: '1',
    });
    expect(component.productionOrderRoute).toEqual(route());
    expect(component.canGenerateRoute).toBe(true);
    expect(component.feedback).toBe('Ordem localizada no Datasul.');
  });

  it('keeps typed fields when the production order lookup fails', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'getProductionOrderRoute').mockReturnValue(throwError(() => new Error('offline')));
    const component = createComponent(qualityControlService);
    component.orderNumber = '372635';
    component.opNumber = '10';
    component.split = '1';

    component.searchOrder();

    expect(component.orderNumber).toBe('372635');
    expect(component.opNumber).toBe('10');
    expect(component.split).toBe('1');
    expect(component.productionOrderRoute).toBeUndefined();
    expect(component.feedback).toBe('Nao foi possivel consultar a Ordem no Datasul.');
  });

  it('generates the route with movimenta saldo and navigates to process inspection', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'generateInspectionRoute').mockReturnValue(of(route()));
    const router = { navigate: vi.fn() };
    const component = createComponent(qualityControlService, router);
    component.productionOrderRoute = route();
    component.moveBalance = true;

    component.generateRoute();

    expect(qualityControlService.generateInspectionRoute).toHaveBeenCalledWith({
      route: route(),
      moveBalance: true,
    });
    expect(router.navigate).toHaveBeenCalledWith(['/quality-control/inspection'], {
      state: { productionOrderRoute: route() },
    });
  });
});
