import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityExam } from '../../models/quality-exam';
import { QualityControlService } from '../../services/quality-control';

import { QualityControlHome } from './quality-control-home';

describe('QualityControlHome', () => {
  function createComponent(): QualityControlHome {
    return new QualityControlHome(new QualityControlService());
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

  function exam(status: 'PENDING' | 'APPROVED' | 'REJECTED', authorized = false): QualityExam {
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
          id: '500517-010',
          code: '010',
          description: 'Cota 488,0 +/- 3,0mm',
          reference: '485 - 491',
          minValue: 485,
          maxValue: 491,
          unit: 'mm',
          sequence: 10,
          status,
          measuredValue: status === 'PENDING' ? undefined : 488,
          authorization: authorized
            ? {
                supervisorId: 'SUP01',
                reason: 'Plano de reacao aplicado.',
                approvedAt: new Date('2026-06-23T10:00:00'),
              }
            : undefined,
        },
      ],
    };
  }

  it('blocks save before route and exams are loaded', () => {
    const component = createComponent();

    expect(component.canSaveInspection).toBe(false);
    expect(component.saveBlockReason).toBe('Gere o roteiro e carregue os exames antes de salvar.');
  });

  it('blocks save while a component is pending', () => {
    const component = createComponent();
    component.productionOrderRoute = route();
    component.qualityExams = [exam('PENDING')];

    expect(component.canSaveInspection).toBe(false);
    expect(component.saveBlockReason).toBe('Conclua todas as medicoes antes de salvar.');
  });

  it('blocks save when a rejected component has no authorization', () => {
    const component = createComponent();
    component.productionOrderRoute = route();
    component.qualityExams = [exam('REJECTED')];

    expect(component.canSaveInspection).toBe(false);
    expect(component.saveBlockReason).toBe('Autorize o plano de reacao para componentes reprovados antes de salvar.');
  });

  it('allows save when a rejected component is authorized', () => {
    const component = createComponent();
    component.productionOrderRoute = route();
    component.qualityExams = [exam('REJECTED', true)];

    expect(component.canSaveInspection).toBe(true);
    expect(component.saveBlockReason).toBe('');
  });

  it('allows save when all components are approved', () => {
    const component = createComponent();
    component.productionOrderRoute = route();
    component.qualityExams = [exam('APPROVED')];

    expect(component.canSaveInspection).toBe(true);
    expect(component.saveBlockReason).toBe('');
  });
});
