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
});
