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
