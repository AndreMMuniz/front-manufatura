import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { BatchReportState, EstadoBatelada } from '../models/reporta-batelada.model';

import { ReportaBateladaService } from './reporta-batelada.service';

describe('ReportaBateladaService', () => {
  let service: ReportaBateladaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ReportaBateladaService);
  });

  it('validates that final report includes only selected items with positive quantity', () => {
    const state = baseState({
      estado: EstadoBatelada.ProducaoIniciada,
      itens: [
        { opId: '1', opNumber: 'OP-1', orderNumber: '450001', productDescription: 'Produto A', quantity: 2, selected: true },
        { opId: '2', opNumber: 'OP-2', orderNumber: '450002', productDescription: 'Produto B', quantity: 0, selected: false },
      ],
    });

    expect(service.validarReporte(state)).toBe('');

    const request = service.toReportRequest(state);

    expect(request.items).toEqual([
      { opId: '1', opNumber: 'OP-1', orderNumber: '450001', quantity: 2 },
    ]);
  });

  it('blocks final report when a selected item has no positive quantity', () => {
    const state = baseState({
      estado: EstadoBatelada.ProducaoIniciada,
      itens: [
        { opId: '1', opNumber: 'OP-1', orderNumber: '450001', productDescription: 'Produto A', quantity: 0, selected: true },
      ],
    });

    expect(service.validarReporte(state)).toBe('Informe quantidade maior que zero para todas as OPs selecionadas.');
  });

  it('accepts datepicker string dates when validating final report', () => {
    const state = baseState({
      estado: EstadoBatelada.ProducaoIniciada,
      dataInicio: '03/07/2026' as unknown as Date,
      dataFim: '03/07/2026' as unknown as Date,
      horaInicio: '08:00',
      horaFim: '09:00',
      itens: [
        { opId: '1', opNumber: 'OP-1', orderNumber: '450001', productDescription: 'Produto A', quantity: 1, selected: true },
      ],
    });

    expect(service.validarReporte(state)).toBe('');
  });

  it('treats ISO date-only strings as local dates when validating final report', () => {
    const state = baseState({
      estado: EstadoBatelada.ProducaoIniciada,
      dataInicio: '2026-07-03T19:05:18.343Z' as unknown as Date,
      dataFim: '2026-07-03' as unknown as Date,
      horaInicio: '16:05',
      horaFim: '23:59',
      itens: [
        { opId: '1', opNumber: 'OP-1', orderNumber: '450001', productDescription: 'Produto A', quantity: 1, selected: true },
      ],
    });

    expect(service.validarReporte(state)).toBe('');
  });
});

function baseState(overrides: Partial<BatchReportState> = {}): BatchReportState {
  return {
    id: 'BAT-001',
    code: 'BAT-001',
    description: 'Batelada mock',
    estado: EstadoBatelada.Carregada,
    dataInicio: new Date(2026, 6, 3),
    horaInicio: '08:00',
    dataFim: new Date(2026, 6, 3),
    horaFim: '09:00',
    quantidadeRefugo: 0,
    quantidadeRetrabalho: 0,
    productionInfo: {
      ct: 'CT-EXT-01',
      gm: 'Extrusoras',
      operatorId: 'OP-001',
      operatorName: 'Ana Silva',
      teamName: 'Equipe A',
      shift: '1o Turno',
    },
    itens: [],
    ...overrides,
  };
}
