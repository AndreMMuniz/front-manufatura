import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ProductionContext, StopEntry, StopReason } from '../models/reporte-paradas.model';

import { ReporteParadasService } from './reporte-paradas.service';

describe('ReporteParadasService', () => {
  const service = new ReporteParadasService();
  const reason: StopReason = { id: 2, code: '02', description: 'Almoço' };
  const context: ProductionContext = {
    workCenter: 'CT-ESTAMP-01',
    machineGroup: 'Prensas Hidraulicas',
    operatorName: 'Joao Pereira',
    team: 'Equipe A',
    shift: '1o Turno',
    reportId: '450001-OP-10458-01',
    sourceRoute: '/operation-reporting',
  };

  it('loads stop reasons from the mock Datasul boundary', async () => {
    const reasons = await firstValueFrom(service.listReasons());

    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some(item => item.description === 'Almoço')).toBe(true);
  });

  it('calculates stop duration from start and end timestamps', () => {
    expect(service.formatDuration(stop({ startTime: '12:00', endTime: '13:15' }))).toBe('01:15:00');
  });

  it('blocks save without a production context', () => {
    expect(service.validateStops([stop()], null)).toBe('Abra o reporte de paradas a partir de uma operação iniciada.');
  });

  it('blocks save without stops', () => {
    expect(service.validateStops([], context)).toBe('Adicione ao menos um motivo de parada.');
  });

  it('blocks inverted intervals', () => {
    expect(service.validateStops([stop({ startTime: '14:00', endTime: '13:00' })], context)).toContain(
      'não pode ser anterior',
    );
  });

  it('allows a valid stop entry', () => {
    expect(service.validateStops([stop()], context)).toBe('');
  });

  it('uses the batch identifier and preserves shift in a started batch context', () => {
    const setContext = service.setContextFromStartedBatch.bind(service) as (
      workCenter: Parameters<ReporteParadasService['setContextFromStartedBatch']>[0],
      responsavel: Parameters<ReporteParadasService['setContextFromStartedBatch']>[1],
      composition: Parameters<ReporteParadasService['setContextFromStartedBatch']>[2],
      batchId: string,
      shift: string,
    ) => void;
    setContext(
      {
        code: 'CT-EXT-01',
        description: 'Extrusão',
        areaCode: '4001',
        area: 'Produção',
        machineGroup: 'Extrusoras',
        establishment: '101',
        active: true,
      },
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      [
        { id: '1-2', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
        { id: '3', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '20', split: '01' },
      ],
      'batch-42',
      '1o Turno',
    );

    expect(service.getActiveContext()).toEqual(expect.objectContaining({
      reportId: 'batch-42',
      shift: '1o Turno',
    }));
  });

  function stop(overrides: Partial<StopEntry> = {}): StopEntry {
    return {
      id: 1,
      reason,
      startDate: new Date(2026, 5, 30),
      startTime: '12:00',
      endDate: new Date(2026, 5, 30),
      endTime: '13:00',
      programmed: true,
      ...overrides,
    };
  }
});
