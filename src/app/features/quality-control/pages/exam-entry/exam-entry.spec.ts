import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityExam } from '../../models/quality-exam';
import { QualityControlService } from '../../services/quality-control';
import { OperatorService } from '../../../shop-floor/services/operator';

import { ExamEntryPage } from './exam-entry';

describe('ExamEntryPage', () => {
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

  function exam(): QualityExam {
    return {
      id: '61035-10-500517',
      code: '500517',
      description: 'Filmes e Mangueiras',
      version: '1',
      frequency: '2',
      sample: '1 pc',
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
          status: 'PENDING',
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
          status: 'PENDING',
        },
      ],
    };
  }

  function routerWithState(state: Record<string, unknown> = {}) {
    return {
      getCurrentNavigation: () => ({ extras: { state } }),
      navigate: vi.fn(),
    };
  }

  function createPage(
    state: Record<string, unknown> | undefined = { productionOrderRoute: route(), exam: exam() },
    service: QualityControlService = new QualityControlService(),
  ) {
    return new ExamEntryPage(service, routerWithState(state ?? { productionOrderRoute: route(), exam: exam() }) as never);
  }

  it('redirects to inspection when opened without route or exam context', () => {
    const router = routerWithState({});

    const page = new ExamEntryPage(new QualityControlService(), router as never);

    expect(page.feedback).toBe('Selecione um exame antes de iniciar a digitação.');
    expect(router.navigate).toHaveBeenCalledWith(['/quality-control']);
  });

  it('loads exam context and selects the first characteristic in Datasul sequence', () => {
    const page = createPage();

    expect(page.productionOrderRoute?.routeNumber).toBe('475.956');
    expect(page.exam?.code).toBe('500517');
    expect(page.currentCharacteristic?.code).toBe('010');
    expect(page.progressText).toBe('1 / 2');
    expect(page.canGoPrevious).toBe(false);
    expect(page.canGoNext).toBe(true);
  });

  it('blocks invalid min max values without mutating component status', () => {
    const page = createPage();
    page.minimum = '490';
    page.maximum = '488';

    page.saveCurrentMeasurement();

    expect(page.validationMessage).toBe('Min deve ser menor ou igual ao Max.');
    expect(page.currentCharacteristic?.status).toBe('PENDING');
  });

  it('shows the explicit out of range error and preserves typed values', () => {
    const page = createPage();
    page.minimum = '484.99';
    page.maximum = '490';

    page.saveCurrentMeasurement();

    expect(page.errorTitle).toBe('Erro');
    expect(page.validationMessage).toBe('Valores fora da variação permitida');
    expect(page.minimum).toBe('484.99');
    expect(page.maximum).toBe('490');
    expect(page.currentCharacteristic?.status).toBe('PENDING');
  });

  it('saves valid values, updates progress and restores measurements when navigating', async () => {
    const service = new QualityControlService();
    const saveSpy = vi.spyOn(service, 'saveMeasurement').mockReturnValue(
      of({
        componentId: '500517-010',
        measurement: {
          minimum: 486,
          maximum: 489,
          observation: 'OK',
          status: 'APPROVED',
          operatorId: '',
          savedAt: new Date('2026-07-02T10:00:00'),
        },
      }),
    );
    const page = createPage(undefined, service);
    page.minimum = '486';
    page.maximum = '489';
    page.observation = 'OK';

    await firstValueFrom(page.saveCurrentMeasurement());

    expect(saveSpy).toHaveBeenCalledWith({
      examId: '61035-10-500517',
      componentId: '500517-010',
      measurement: {
        minimum: 486,
        maximum: 489,
        observation: 'OK',
        status: 'APPROVED',
      },
      operatorId: '',
    });
    expect(page.currentCharacteristic?.measurement?.minimum).toBe(486);
    expect(page.currentCharacteristic?.status).toBe('APPROVED');
    expect(page.completedCount).toBe(1);

    page.goNext();
    expect(page.currentCharacteristic?.code).toBe('020');

    page.goPrevious();
    expect(page.minimum).toBe('486');
    expect(page.maximum).toBe('489');
    expect(page.observation).toBe('OK');
  });

  it('does not lose typed values when the partial save fails', async () => {
    const service = new QualityControlService();
    vi.spyOn(service, 'saveMeasurement').mockReturnValue(throwError(() => new Error('offline')));
    const page = createPage(undefined, service);
    page.minimum = '486';
    page.maximum = '489';

    await expect(firstValueFrom(page.saveCurrentMeasurement())).resolves.toBeNull();

    expect(page.feedback).toBe('Nao foi possivel salvar a medição. Tente novamente.');
    expect(page.minimum).toBe('486');
    expect(page.maximum).toBe('489');
    expect(page.currentCharacteristic?.status).toBe('PENDING');
  });

  it('saves the selected operator id with the partial measurement', async () => {
    const operatorService = new OperatorService();
    await firstValueFrom(operatorService.selectOperator('OP-001'));
    const service = new QualityControlService();
    const saveSpy = vi.spyOn(service, 'saveMeasurement');
    const page = new ExamEntryPage(
      service,
      routerWithState({ productionOrderRoute: route(), exam: exam() }) as never,
      operatorService,
    );
    page.minimum = '486';
    page.maximum = '489';

    await firstValueFrom(page.saveCurrentMeasurement());

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: 'OP-001',
      }),
    );
    expect(page.currentCharacteristic?.operatorId).toBe('OP-001');
  });

  it('removes invalid characters from min and max fields immediately', () => {
    const page = createPage();

    page.updateMinimum('48a6,5mm');
    page.updateMaximum('49x1.25');

    expect(page.minimum).toBe('486,5');
    expect(page.maximum).toBe('491.25');
  });

  it('returns to inspection with the updated quality exams state', async () => {
    const router = routerWithState({ productionOrderRoute: route(), exam: exam() });
    const page = new ExamEntryPage(new QualityControlService(), router as never);
    page.minimum = '486';
    page.maximum = '489';

    await firstValueFrom(page.saveCurrentMeasurement());
    page.goBack();

    expect(router.navigate).toHaveBeenCalledWith(['/quality-control/inspection'], {
      state: {
        productionOrderRoute: route(),
        qualityExams: page.qualityExams,
      },
    });
    expect(page.qualityExams[0].components[0].measurement?.minimum).toBe(486);
  });

  it('blocks back and exit navigation when there are unsaved measurement edits', () => {
    const router = routerWithState({ productionOrderRoute: route(), exam: exam() });
    const page = new ExamEntryPage(new QualityControlService(), router as never);
    page.minimum = '486';

    page.goBack();
    page.exit();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(page.feedback).toBe('Salve a medição atual antes de sair.');
  });

  it('allows completing the exam only after every characteristic has a saved measurement', async () => {
    const page = createPage();

    page.minimum = '486';
    page.maximum = '489';
    await firstValueFrom(page.saveCurrentMeasurement());

    expect(page.canCompleteExam).toBe(false);

    page.goNext();
    page.minimum = '255';
    page.maximum = '255.2';
    await firstValueFrom(page.saveCurrentMeasurement());

    expect(page.canCompleteExam).toBe(true);
  });
});
