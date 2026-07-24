import { BehaviorSubject } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { WorkCenter } from '../../shop-floor/models/work-center';
import { AreaProducao, EstadoOperacao, OrdemCentroTrabalho, ReportOperacao } from '../models/report-operacao.model';
import { ReportOperacaoWorkflowState } from './report-operacao-workflow-state';

describe('ReportOperacaoWorkflowState', () => {
  const area: AreaProducao = { code: '4001', description: 'Produção' };
  const center: WorkCenter = {
    code: 'CT-EXT-01',
    description: 'Extrusao Linha 01',
    areaCode: '4001',
    area: 'Producao',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
  const orders: OrdemCentroTrabalho[] = [
    { id: 'first', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
    { id: 'second', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '20', split: '01' },
  ];

  it('normalizes multiple selected IDs to one order in visual order and exposes defensive copies', () => {
    const state = new ReportOperacaoWorkflowState();
    state.setContext(area, center);
    state.setOrders(orders);
    state.setSelectedOrderIds(new Set(['second', 'first']));

    const active = state.startQueue();
    const snapshot = state.snapshot();

    expect(active?.id).toBe('first');
    expect(snapshot.queue.map(order => order.id)).toEqual(['first']);
    expect([...snapshot.selectedOrderIds]).toEqual(['first']);
    expect(snapshot.selectedOrderIds).not.toBe(state.snapshot().selectedOrderIds);
    expect(snapshot.orders[0]).not.toBe(orders[0]);
  });

  it('completes the single selected order and clears order-specific data', () => {
    const state = queuedState();
    state.setActiveOperation(operation(), EstadoOperacao.OperacaoIniciada);
    state.setScrap([{ codigo: '05', descricao: 'Borra', quantidade: 2 }], '05 - Borra');
    state.setResponsavel({ tipo: 'OPERADOR', codigo: '001', nome: 'Jose Ribeiro Neto' });
    state.addReporte({
      id: 'APT-1',
      idempotencyKey: 'draft-1',
      registradoEm: new Date(2026, 6, 23, 10),
      dataInicio: new Date(2026, 6, 23, 9),
      horaInicio: '09:00',
      dataFim: new Date(2026, 6, 23, 10),
      horaFim: '10:00',
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
    });

    const next = state.completeActiveOrder();
    const snapshot = state.snapshot();

    expect(next).toBeNull();
    expect(snapshot.queue).toEqual([]);
    expect(snapshot.selectedOrderIds.size).toBe(0);
    expect(snapshot.operation).toBeNull();
    expect(snapshot.operationState).toBe(EstadoOperacao.SemOP);
    expect(snapshot.scrapItems).toEqual([]);
    expect(snapshot.lastScrapReason).toBe('');
    expect(snapshot.responsavel).toBeNull();
    expect(snapshot.reportes).toEqual([]);
  });

  it('keeps defensive copies of the selected responsible and partial reports', () => {
    const state = queuedState();
    const registradoEm = new Date(2026, 6, 23, 10);
    state.setResponsavel({ tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Montagem Zap' });
    const reporte = {
      id: 'APT-1',
      idempotencyKey: 'draft-1',
      registradoEm,
      dataInicio: new Date(2026, 6, 23, 9),
      horaInicio: '09:00',
      dataFim: new Date(2026, 6, 23, 10),
      horaFim: '10:00',
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 1,
      quantidadeRefugo: 0,
      refugoItens: [],
    };
    state.addReporte(reporte);
    state.addReporte({ ...reporte, id: 'APT-RETRY' });

    const first = state.snapshot();
    const second = state.snapshot();

    expect(first.responsavel).toEqual({ tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Montagem Zap' });
    expect(first.responsavel).not.toBe(second.responsavel);
    expect(first.reportes[0]).not.toBe(second.reportes[0]);
    expect(first.reportes[0].registradoEm).not.toBe(registradoEm);
    expect(first.reportes).toHaveLength(1);
  });

  it('canonicaliza o código do responsável preservando a chave composta por tipo', () => {
    const state = queuedState();

    state.setResponsavel({ tipo: 'EQUIPE', codigo: ' mont03 ', nome: 'Montagem Zap' });

    expect(state.snapshot().responsavel).toEqual({
      tipo: 'EQUIPE',
      codigo: 'MONT03',
      nome: 'Montagem Zap',
    });
  });

  it('preserves the complete workflow until an explicit change or logout', () => {
    const sessionSubject = new BehaviorSubject<unknown>({ user: {}, token: 'token' });
    const state = new ReportOperacaoWorkflowState({
      session$: sessionSubject.asObservable(),
    } as AuthSessionService);
    state.setContext(area, center);
    state.setOrders(orders);
    state.setSelectedOrderIds(new Set(['first']));
    state.startQueue();
    state.setActiveOperation(operation(), EstadoOperacao.OPEncontrada);

    expect(state.hasActiveWorkflow()).toBe(true);
    expect(state.snapshot().operation?.ordem).toBe('450001');

    sessionSubject.next(null);

    expect(state.snapshot()).toMatchObject({
      area: null,
      workCenter: null,
      orders: [],
      queue: [],
      activeOrder: null,
      operation: null,
      operationState: EstadoOperacao.SemOP,
    });
  });

  it('normalizes a restored legacy snapshot to its single active order', () => {
    const source = queuedState().snapshot();
    const state = new ReportOperacaoWorkflowState();

    state.restore({
      ...source,
      selectedOrderIds: new Set(orders.map(order => order.id)),
      queue: orders,
      activeOrder: orders[1],
    });

    expect([...state.snapshot().selectedOrderIds]).toEqual(['second']);
    expect(state.snapshot().queue.map(order => order.id)).toEqual(['second']);
    expect(state.snapshot().activeOrder?.id).toBe('second');
  });

  it('canonicalizes the responsible code while restoring a snapshot', () => {
    const source = queuedState().snapshot();
    const state = new ReportOperacaoWorkflowState();

    state.restore({
      ...source,
      responsavel: { tipo: 'EQUIPE', codigo: ' mont03 ', nome: 'Equipe A' },
    });

    expect(state.snapshot().responsavel).toEqual({
      tipo: 'EQUIPE',
      codigo: 'MONT03',
      nome: 'Equipe A',
    });
  });

  it('clears dependent workflow while allowing a new production context', () => {
    const state = queuedState();

    state.setContext({ code: '4002', description: 'Qualidade' }, null);

    expect(state.snapshot()).toMatchObject({
      area: { code: '4002' },
      workCenter: null,
      orders: [],
      queue: [],
      activeOrder: null,
    });
  });

  it('refreshes same-code context metadata without discarding the active workflow', () => {
    const state = queuedState();
    const refreshedArea = { ...area, description: 'Produção atualizada' };
    const refreshedCenter = { ...center, description: 'Extrusão atualizada', machineGroup: 'Extrusoras 2' };

    state.setContext(refreshedArea, refreshedCenter);

    expect(state.snapshot()).toMatchObject({
      area: refreshedArea,
      workCenter: refreshedCenter,
      activeOrder: { id: 'first' },
      queue: [{ id: 'first' }],
    });
  });

  function queuedState(): ReportOperacaoWorkflowState {
    const state = new ReportOperacaoWorkflowState();
    state.setContext(area, center);
    state.setOrders(orders);
    state.setSelectedOrderIds(new Set(orders.map(order => order.id)));
    state.startQueue();
    return state;
  }

  function operation(): ReportOperacao {
    return {
      ordem: '450001',
      op: 'OP-1',
      split: '01',
      item: 'ITEM-1',
      descricao: 'Produto',
      unidade: 'PC',
      roteiro: '10 - Extrusão',
      quantidadeOrdem: 10,
      quantidadeSaldo: 10,
      linha: center.description,
      horaInicio: '08:00',
      horaFim: '',
      dataInicio: new Date(2026, 6, 23),
      quantidadeAprovada: 0,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 2,
      ct: center.code,
      grupoMaquina: center.machineGroup,
      operador: 'Ana Silva',
      equipe: 'Equipe A',
      turno: '1o Turno',
    };
  }
});
