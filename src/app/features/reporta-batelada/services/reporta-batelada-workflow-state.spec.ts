import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import {
  EstadoBatelada,
  OrdemLiberadaBatelada,
  ResponsavelBatelada,
} from '../models/reporta-batelada.model';

import { ReportaBateladaWorkflowState } from './reporta-batelada-workflow-state';

describe('ReportaBateladaWorkflowState', () => {
  let state: ReportaBateladaWorkflowState;
  const session$ = new BehaviorSubject<unknown>({ user: 'operador' });

  beforeEach(() => {
    session$.next({ user: 'operador' });
    TestBed.configureTestingModule({
      providers: [
        ReportaBateladaWorkflowState,
        { provide: AuthSessionService, useValue: { session$ } },
      ],
    });
    state = TestBed.inject(ReportaBateladaWorkflowState);
  });

  it('starts with pending context and returns defensive snapshots', () => {
    state.setArea({ code: '4001', description: 'Produção' });
    const first = state.snapshot();

    (first.area as { description: string }).description = 'Mutada';

    expect(state.snapshot().area?.description).toBe('Produção');
    expect(state.snapshot().estado).toBe(EstadoBatelada.ContextoPendente);
  });

  it('preserves selection order and prepares only IDs from the current result', () => {
    prepareContext();
    state.setOrders([order('1'), order('2'), order('3')]);

    state.selectOrder('2', true);
    state.selectOrder('1', true);
    state.selectOrder('fora-do-resultado', true);
    state.prepareBatch();

    expect(state.snapshot().selectedOrderIds).toEqual(['2', '1']);
    expect(state.snapshot().composition.map(item => item.id)).toEqual(['2', '1']);
    expect(state.snapshot().estado).toBe(EstadoBatelada.BateladaPreparada);
  });

  it('invalidates CT, query, selection and composition when Area changes', () => {
    prepareBatch();

    expect(state.setArea({ code: '4002', description: 'Qualidade' })).toBe(true);
    expect(state.snapshot()).toEqual(expect.objectContaining({
      workCenter: null,
      orders: [],
      selectedOrderIds: [],
      composition: [],
      responsavel: null,
      estado: EstadoBatelada.ContextoPendente,
    }));
  });

  it('invalidates query, selection and composition when work center changes', () => {
    prepareBatch();

    expect(state.setWorkCenter(workCenter('CT-EXT-02'))).toBe(true);
    expect(state.snapshot()).toEqual(expect.objectContaining({
      orders: [],
      selectedOrderIds: [],
      composition: [],
      responsavel: null,
      estado: EstadoBatelada.ContextoPendente,
    }));
  });

  it('prefills the operator from context only when it is eligible', () => {
    prepareContext();
    state.setResponsaveis([responsavel(), { tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' }], 'OP-001');

    expect(state.snapshot().responsavel).toEqual(responsavel());

    state.setResponsaveis([{ tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' }], 'OP-999');
    expect(state.snapshot().responsavel).toBeNull();
  });

  it('allows start only for prepared composition with a valid responsible party', () => {
    prepareBatch();
    expect(state.canStart()).toBe(false);

    state.setResponsaveis([responsavel()]);
    state.setResponsavel(responsavel());

    expect(state.canStart()).toBe(true);
    expect(state.beginStart()).toBe(true);
    expect(state.snapshot().estado).toBe(EstadoBatelada.Iniciando);
    expect(state.beginStart()).toBe(false);
  });

  it('restores the last valid operational state and preserves data after start failure', () => {
    prepareBatch();
    state.setResponsaveis([responsavel()]);
    state.setResponsavel(responsavel());
    state.beginStart();

    state.failStart('Datasul indisponível');

    expect(state.snapshot()).toEqual(expect.objectContaining({
      estado: EstadoBatelada.BateladaPreparada,
      errorMessage: 'Datasul indisponível',
      composition: [order('2'), order('1')],
      responsavel: responsavel(),
    }));
  });

  it('locks context, responsible party and composition after successful start', () => {
    prepareBatch();
    state.setResponsaveis([responsavel()]);
    state.setResponsavel(responsavel());
    state.beginStart();
    state.completeStart({ iniciadoEm: new Date(2026, 6, 23, 8, 15), ordensIniciadas: ['2', '1'] });

    expect(state.setArea({ code: '4002', description: 'Qualidade' })).toBe(false);
    expect(state.setWorkCenter(workCenter('CT-EXT-02'))).toBe(false);
    expect(state.setResponsavel({ tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' })).toBe(false);
    expect(state.selectOrder('1', false)).toBe(false);
    expect(state.snapshot().estado).toBe(EstadoBatelada.BateladaIniciada);
    expect(state.snapshot().inicio?.iniciadoEm).toEqual(new Date(2026, 6, 23, 8, 15));
  });

  it('clears page state on logout', () => {
    prepareBatch();
    session$.next(null);

    expect(state.snapshot()).toEqual(expect.objectContaining({
      area: null,
      workCenter: null,
      composition: [],
      estado: EstadoBatelada.ContextoPendente,
    }));
  });

  function prepareContext(): void {
    state.setArea({ code: '4001', description: 'Produção' });
    state.setWorkCenter(workCenter());
  }

  function prepareBatch(): void {
    prepareContext();
    state.setOrders([order('1'), order('2')]);
    state.selectOrder('2', true);
    state.selectOrder('1', true);
    state.prepareBatch();
  }
});

function workCenter(code = 'CT-EXT-01') {
  return {
    code,
    description: 'Extrusão Linha 01',
    areaCode: '4001',
    area: 'Produção',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
}

function order(id: string): OrdemLiberadaBatelada {
  return {
    id,
    ordem: `45000${id}`,
    itemOp: `PERFIL-${id} / OP-${id}`,
    operacao: '10',
    split: '01',
  };
}

function responsavel(): ResponsavelBatelada {
  return { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' };
}
