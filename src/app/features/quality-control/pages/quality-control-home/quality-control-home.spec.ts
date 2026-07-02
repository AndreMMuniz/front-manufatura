import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { OperatorService } from '../../../shop-floor/services/operator';
import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityComponentStatus, QualityExam } from '../../models/quality-exam';
import { QualityControlService } from '../../services/quality-control';

import { QualityControlHome } from './quality-control-home';

describe('QualityControlHome', () => {
  function createComponent(
    operatorService: OperatorService = new OperatorService(),
    qualityControlService: QualityControlService = new QualityControlService(),
    router: { getCurrentNavigation: () => unknown; navigate: ReturnType<typeof vi.fn> } = routerWithRoute(route()),
  ): QualityControlHome {
    return new QualityControlHome(qualityControlService, operatorService, router as never);
  }

  function routerWithRoute(productionOrderRoute?: ProductionOrderRoute) {
    return {
      getCurrentNavigation: () => ({
        extras: {
          state: productionOrderRoute ? { productionOrderRoute } : {},
        },
      }),
      navigate: vi.fn(),
    };
  }

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

  function exam(status: QualityComponentStatus = 'PENDING'): QualityExam {
    return {
      id: '61035-10-500517',
      code: '500517',
      description: 'Filmes e Mangueiras',
      version: '1',
      frequency: '2',
      unit: 'pc',
      nqa: '0,000',
      level: '1',
      components: [
        {
          id: '500517-020',
          code: '020',
          description: 'Cota 255,0 +/- 0,5mm',
          reference: '254,5 - 255,5',
          minValue: 254.5,
          maxValue: 255.5,
          unit: 'mm',
          sequence: 20,
          status,
        },
        {
          id: '500517-010',
          code: '010',
          description: 'Cota 488,0 +/- 3,0mm',
          reference: '485 - 491',
          minValue: 485,
          maxValue: 491,
          unit: 'mm',
          sequence: 10,
          status,
        },
      ],
    };
  }

  it('redirects to route generation when no generated route is provided', () => {
    const router = routerWithRoute(undefined);

    const component = createComponent(new OperatorService(), new QualityControlService(), router);

    expect(component.productionOrderRoute).toBeUndefined();
    expect(component.feedback).toBe('Gere o roteiro antes de iniciar a inspeção de processo.');
    expect(router.navigate).toHaveBeenCalledWith(['/quality-control']);
  });

  it('loads and orders components from the generated route navigation context', () => {
    const qualityControlService = new QualityControlService();
    const getQualityExamsSpy = vi.spyOn(qualityControlService, 'getQualityExams').mockReturnValue(of([exam()]));

    const component = createComponent(new OperatorService(), qualityControlService);

    expect(component.productionOrderRoute).toEqual(route());
    expect(getQualityExamsSpy).toHaveBeenCalledWith('61035', '10');
    expect(component.components.map(item => item.code)).toEqual(['010', '020']);
    expect(component.selectedComponent?.code).toBe('010');
    expect(component.progressPercentage).toBe(0);
  });

  it('blocks selection outside the Datasul sequence', () => {
    const component = createComponent();
    const secondComponent = component.components[1];

    component.selectComponent(secondComponent);

    expect(component.selectedComponent?.code).toBe('010');
    expect(component.feedback).toBe('Siga a sequência do roteiro definida pelo Datasul.');
  });

  it('registers approval immediately and advances to the next component', () => {
    const qualityControlService = new QualityControlService();
    const registerSpy = vi.spyOn(qualityControlService, 'registerComponentResult').mockReturnValue(
      of({
        componentId: '500517-010',
        status: 'APPROVED',
        inspectedAt: new Date('2026-06-23T10:00:00'),
        operatorId: '',
      }),
    );
    const component = createComponent(new OperatorService(), qualityControlService);

    component.approveSelectedComponent();

    expect(registerSpy).toHaveBeenCalledWith({
      routeNumber: '475.956',
      examId: '61035-10-500517',
      componentId: '500517-010',
      result: 'APPROVED',
      operatorId: '',
    });
    expect(component.components[0].status).toBe('APPROVED');
    expect(component.selectedComponent?.code).toBe('020');
    expect(component.selectedComponent?.status).toBe('IN_PROGRESS');
    expect(component.progressPercentage).toBe(33);
  });

  it('keeps the current component selected when register result fails', () => {
    const qualityControlService = new QualityControlService();
    vi.spyOn(qualityControlService, 'registerComponentResult').mockReturnValue(throwError(() => new Error('offline')));
    const component = createComponent(new OperatorService(), qualityControlService);

    component.rejectSelectedComponent();

    expect(component.selectedComponent?.code).toBe('010');
    expect(component.selectedComponent?.status).toBe('PENDING');
    expect(component.feedback).toBe('Nao foi possivel registrar o resultado. Tente novamente.');
  });

  it('marks inspection as finished only when every component is registered', () => {
    const component = createComponent();

    component.components[0].status = 'APPROVED';
    expect(component.isInspectionFinished).toBe(false);
    expect(component.canSaveInspection).toBe(false);

    component.components[1].status = 'REJECTED';
    component.components[2].status = 'APPROVED';
    expect(component.isInspectionFinished).toBe(true);
  });

  it('requires selected operator before closing when operator selection is mandatory', () => {
    const component = createComponent();
    component.components.forEach(item => (item.status = 'APPROVED'));

    expect(component.canSaveInspection).toBe(false);
    expect(component.saveBlockReason).toBe('Selecione o operador ativo antes de salvar.');
  });

  it('allows closure after all components are registered and the operator is selected', async () => {
    const operatorService = new OperatorService();
    await firstValueFrom(operatorService.selectOperator('OP-001'));
    const component = createComponent(operatorService);
    component.components.forEach(item => (item.status = 'APPROVED'));

    expect(component.operatorId).toBe('OP-001');
    expect(component.canSaveInspection).toBe(true);
    expect(component.saveBlockReason).toBe('');
  });

  it('navigates back to route generation and exits to main menu', () => {
    const router = routerWithRoute(route());
    const component = createComponent(new OperatorService(), new QualityControlService(), router);

    component.goBack();
    component.exit();

    expect(router.navigate).toHaveBeenCalledWith(['/quality-control']);
    expect(router.navigate).toHaveBeenCalledWith(['/menu']);
  });
});
