import { firstValueFrom } from 'rxjs';

import { QualityExamComponent } from '../models/quality-exam';

import { QualityControlService } from './quality-control';

describe('QualityControlService', () => {
  const service = new QualityControlService();
  const component: QualityExamComponent = {
    id: '500517-010',
    code: '010',
    description: 'Cota 488,0 +/- 3,0mm',
    reference: '485 - 491',
    minValue: 485,
    maxValue: 491,
    unit: 'mm',
    sequence: 10,
    status: 'PENDING',
  };

  it('returns the operations linked to a production order', async () => {
    await expect(
      firstValueFrom(service.getProductionOrderOperations('325571')),
    ).resolves.toMatchObject({
      orderNumber: '325571',
      operations: [
        {
          operationCode: '10',
          operationDescription: 'Cortar chapa',
        },
        {
          operationCode: '20',
          operationDescription: 'Dobrar chapa',
        },
        {
          operationCode: '30',
          operationDescription: 'Soldar',
        },
      ],
    });
  });

  it('generates the inspection route from the selected operation', async () => {
    const operation = {
      operationCode: '20',
      operationDescription: 'Dobrar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca Master 75 OP10',
      processDescription: 'Dobra de chapa',
    };

    await expect(
      firstValueFrom(
        service.generateInspectionRoute({
          orderNumber: '325571',
          operation,
          moveBalance: false,
        }),
      ),
    ).resolves.toEqual({
      routeNumber: '475.956',
      processDescription: 'Dobra de chapa',
      currentOrder: '325571',
      operationCode: '20',
      operationDescription: '20 - Dobrar chapa',
      split: '1',
      itemCode: '30907',
      itemDescription: 'Alavanca Master 75 OP10',
    });
  });

  it('returns the exam metadata for the inspection header', async () => {
    await expect(firstValueFrom(service.getQualityExams('30907', '20'))).resolves.toEqual([
      expect.objectContaining({
        frequency: '2',
        sample: '1 pc',
        observation: 'Visual 100% do corte !',
      }),
    ]);
  });

  it('approves values inside tolerance', () => {
    expect(service.validateMeasurement(component, 488)).toBe('APPROVED');
  });

  it('approves values equal to tolerance boundaries', () => {
    expect(service.validateMeasurement(component, 485)).toBe('APPROVED');
    expect(service.validateMeasurement(component, 491)).toBe('APPROVED');
  });

  it('rejects values outside tolerance', () => {
    expect(service.validateMeasurement(component, 484.99)).toBe('REJECTED');
    expect(service.validateMeasurement(component, 491.01)).toBe('REJECTED');
  });

  it('approves min and max measurements inside tolerance boundaries', () => {
    expect(service.validateMeasurementRange(component, { minimum: 485, maximum: 491 })).toEqual({
      valid: true,
      status: 'APPROVED',
    });
  });

  it('blocks measurement ranges when minimum is greater than maximum', () => {
    expect(service.validateMeasurementRange(component, { minimum: 490, maximum: 488 })).toEqual({
      valid: false,
      reason: 'INVALID_RANGE',
      message: 'Min deve ser menor ou igual ao Max.',
    });
  });

  it('blocks measurement ranges outside tolerance without approving the component', () => {
    expect(service.validateMeasurementRange(component, { minimum: 484.99, maximum: 490 })).toEqual({
      valid: false,
      reason: 'OUT_OF_RANGE',
      message: 'Valores fora da variação permitida',
    });

    expect(service.validateMeasurementRange(component, { minimum: 486, maximum: 491.01 })).toEqual({
      valid: false,
      reason: 'OUT_OF_RANGE',
      message: 'Valores fora da variação permitida',
    });
  });

  it('persists a partial min max measurement through the service boundary', async () => {
    const result = await firstValueFrom(
      service.saveMeasurement({
        examId: '61035-10-500517',
        componentId: component.id,
        measurement: {
          minimum: 486,
          maximum: 489,
          observation: 'Medição conferida',
          status: 'APPROVED',
        },
        operatorId: 'OP-001',
      }),
    );

    expect(result).toMatchObject({
      componentId: component.id,
      measurement: {
        minimum: 486,
        maximum: 489,
        observation: 'Medição conferida',
        status: 'APPROVED',
        operatorId: 'OP-001',
      },
    });
    expect(result.measurement.savedAt).toBeInstanceOf(Date);
  });

  it('stops an inspection route with an auditable reason', async () => {
    const result = await firstValueFrom(service.stopInspectionRoute({
      routeNumber: '475.956',
      examId: '61035-10-500517',
      reason: 'Aguardar conferência do supervisor',
    }));

    expect(result).toMatchObject({
      routeNumber: '475.956',
      examId: '61035-10-500517',
      reason: 'Aguardar conferência do supervisor',
    });
    expect(result.stoppedAt).toBeInstanceOf(Date);
  });
});
