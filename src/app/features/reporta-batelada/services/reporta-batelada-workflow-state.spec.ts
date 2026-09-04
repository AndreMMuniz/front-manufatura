import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import {
  EstadoBatelada,
  OrdemLiberadaBatelada,
  ReporteParcialBatelada,
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

  it('prefills the free operator code from context without requiring catalog eligibility', () => {
    prepareContext();
    state.setResponsaveis([responsavel(), { tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' }], 'OP-001');

    expect(state.snapshot().responsavel).toEqual(responsavel());

    state.setResponsaveis([{ tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' }], 'OP-999');
    expect(state.snapshot().responsavel).toEqual({
      tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva',
    });
  });

  it('aceita operador livre, preserva formato e rejeita valor composto apenas por espaços', () => {
    prepareBatch();

    expect(state.setResponsavel({
      tipo: 'OPERADOR', codigo: ' op.int/7-a ', nome: ' op.int/7-a ',
    })).toBe(true);
    expect(state.snapshot().responsavel).toEqual({
      tipo: 'OPERADOR', codigo: ' op.int/7-a ', nome: ' op.int/7-a ',
    });
    expect(state.canStart()).toBe(true);

    expect(state.setResponsavel({ tipo: 'OPERADOR', codigo: '   ', nome: '' })).toBe(false);
    expect(state.snapshot().responsavel).toBeNull();
    expect(state.canStart()).toBe(false);
  });

  it('limpa o responsável incompatível ao alternar o modo antes do início', () => {
    prepareBatch();
    state.setResponsavel({ tipo: 'OPERADOR', codigo: 'op.int/7-a', nome: '' });

    expect(state.setTipoResponsavel('EQUIPE')).toBe(true);
    expect(state.snapshot().tipoResponsavel).toBe('EQUIPE');
    expect(state.snapshot().responsavel).toBeNull();
  });

  it('normaliza e deduplica responsáveis pela chave composta sem colisão entre tipos', () => {
    prepareContext();
    state.setResponsaveis([
      { tipo: 'OPERADOR', codigo: ' op-001 ', nome: 'Ana Silva' },
      { tipo: 'EQUIPE', codigo: 'OP-001', nome: 'Equipe homônima' },
      { tipo: 'EQUIPE', codigo: ' op-001 ', nome: 'Equipe atualizada' },
    ]);

    expect(state.snapshot().responsaveis).toEqual([
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      { tipo: 'EQUIPE', codigo: 'OP-001', nome: 'Equipe atualizada' },
    ]);
    state.setTipoResponsavel('EQUIPE');
    expect(state.setResponsavel({
      tipo: 'EQUIPE',
      codigo: ' op-001 ',
      nome: 'ignorado na fronteira',
    })).toBe(true);
    expect(state.snapshot().responsavel).toEqual({
      tipo: 'EQUIPE',
      codigo: 'OP-001',
      nome: 'Equipe atualizada',
    });
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

  it('does not allow a second start when every selected split is already open', () => {
    prepareContext();
    state.setOrders([
      { ...order('1'), indEstadoSplit: 4 } as unknown as OrdemLiberadaBatelada,
      { ...order('2'), indEstadoSplit: 4 } as unknown as OrdemLiberadaBatelada,
    ]);
    state.selectOrder('1', true);
    state.selectOrder('2', true);
    state.prepareBatch();
    state.setResponsaveis([responsavel()]);
    state.setResponsavel(responsavel());

    expect(state.canStart()).toBe(false);
    expect(state.beginStart()).toBe(false);
  });

  it('blocks a mixed composition of open and not-started splits with an actionable message', () => {
    prepareContext();
    state.setOrders([
      { ...order('1'), indEstadoSplit: 4 } as unknown as OrdemLiberadaBatelada,
      { ...order('2'), indEstadoSplit: 3 } as unknown as OrdemLiberadaBatelada,
    ]);
    state.selectOrder('1', true);
    state.selectOrder('2', true);

    state.prepareBatch();

    expect(state.canStart()).toBe(false);
    expect(state.canReport()).toBe(false);
    expect(state.snapshot().errorMessage).toBe(
      'Selecione somente ordens que estejam todas iniciadas ou todas não iniciadas.',
    );
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
    state.completeStart({
      batchId: 'batch-1',
      iniciadoEm: new Date(2026, 6, 23, 8, 15),
      ordensIniciadas: ['2', '1'],
    });

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

  it('unsubscribes from the auth session when the page-scoped workflow is destroyed', () => {
    expect(session$.observers).toHaveLength(1);

    TestBed.resetTestingModule();

    expect(session$.observers).toHaveLength(0);
  });

  it('stores a deeply defensive multi-order draft and invalidates its key after changes', () => {
    startBatch();
    const draft = {
      idempotencyKey: 'idem-1',
      items: report().items,
    };

    state.setDraft(draft);
    const first = state.snapshot().draft;
    (first?.items[0].refugoItens[0] as { quantidade: number }).quantidade = 99;

    expect(state.snapshot().draft?.items[0].refugoItens[0].quantidade).toBe(1);

    state.setDraft({
      idempotencyKey: 'idem-1',
      items: draft.items.map((item, index) =>
        index === 0 ? { ...item, quantidadeAprovada: 11 } : item),
    });
    expect(state.snapshot().draft?.idempotencyKey).toBeNull();
  });

  it('transitions through reporting, preserves a failed draft and deduplicates confirmation', () => {
    startBatch();
    const draft = { idempotencyKey: 'idem-1', items: report().items };
    state.setDraft(draft);

    expect(state.beginReport()).toBe(true);
    expect(state.snapshot().estado).toBe(EstadoBatelada.ReportandoParcial);
    expect(state.beginReport()).toBe(false);

    state.failReport('Falha Datasul');
    expect(state.snapshot()).toEqual(expect.objectContaining({
      estado: EstadoBatelada.BateladaIniciada,
      reportAsyncState: 'erro',
      draft,
    }));

    state.beginReport();
    state.completeReport(report());
    state.completeReport(report());

    expect(state.snapshot().estado).toBe(EstadoBatelada.BateladaIniciada);
    expect(state.snapshot().history).toHaveLength(1);
    expect(state.snapshot().draft?.items.every(item =>
      item.quantidadeAprovada === 0 &&
      item.quantidadeRetrabalho === 0 &&
      item.quantidadeRefugo === 0 &&
      item.refugoItens.length === 0)).toBe(true);
  });

  it('merges restored history without loss, reorder or duplication', () => {
    startBatch();
    const second = report('report-2', 'idem-2', new Date(2026, 6, 23, 10));

    state.setHistory([report(), second, report()]);
    state.setHistory([report(), second]);

    expect(state.snapshot().history.map(item => item.reporteId)).toEqual(['report-1', 'report-2']);
    expect(state.snapshot().historyAsyncState).toBe('sucesso');
  });

  it('does not erase a locally confirmed report when a stale history response arrives', () => {
    startBatch();
    const first = report();
    const local = report('report-local', 'idem-local', new Date(2026, 6, 23, 11));
    state.setHistory([first]);
    state.setDraft({ idempotencyKey: 'idem-local', items: local.items });
    state.beginReport();
    state.completeReport(local);

    state.setHistory([first]);

    expect(state.snapshot().history.map(item => item.reporteId))
      .toEqual(['report-1', 'report-local']);
  });

  it('derives rounded order and consolidated totals exclusively from confirmed history', () => {
    startBatch();
    state.setDraft({
      idempotencyKey: null,
      items: report().items.map(item => ({ ...item, quantidadeAprovada: 1000 })),
    });
    state.setHistory([
      report(),
      {
        ...report('report-2', 'idem-2'),
        items: report().items.map(item => ({
          ...item,
          quantidadeAprovada: 0.0006,
          quantidadeRetrabalho: 0.0006,
          quantidadeRefugo: 0,
          refugoItens: [],
        })),
      },
    ]);

    expect(state.totalsByOrder()).toEqual([
      {
        orderId: '2',
        ordem: '450002',
        quantidadeAprovada: 8.252,
        quantidadeRetrabalho: 0.502,
        quantidadeRefugo: 1,
        quantidadeTotal: 9.754,
      },
      {
        orderId: '1',
        ordem: '450001',
        quantidadeAprovada: 10.126,
        quantidadeRetrabalho: 0.001,
        quantidadeRefugo: 1,
        quantidadeTotal: 11.127,
      },
    ]);
    expect(state.batchTotals()).toEqual({
      quantidadeAprovada: 18.378,
      quantidadeRetrabalho: 0.503,
      quantidadeRefugo: 2,
      quantidadeTotal: 20.881,
    });
  });

  it('preserves the full operational snapshot through the stop flow', () => {
    startBatch();
    state.setHistory([report()]);
    state.setDraft({ idempotencyKey: 'idem-2', items: report().items });

    expect(state.enterStop()).toBe(true);
    expect(state.snapshot().estado).toBe(EstadoBatelada.EmParada);
    expect(state.returnFromStop()).toBe(true);

    expect(state.snapshot()).toEqual(expect.objectContaining({
      estado: EstadoBatelada.BateladaIniciada,
      history: [report()],
      draft: { idempotencyKey: 'idem-2', items: report().items },
    }));
  });

  it('canonicalizes and deduplicates responsible identities restored after a stop', () => {
    startBatch();
    expect(state.enterStop()).toBe(true);
    const stopped = state.snapshot();
    const restored = new ReportaBateladaWorkflowState();

    expect(restored.restoreAfterStop({
      ...stopped,
      responsaveis: [
        { tipo: 'EQUIPE', codigo: ' mont03 ', nome: 'Equipe antiga' },
        { tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Equipe canônica' },
        { tipo: 'OPERADOR', codigo: ' mont03 ', nome: 'Operador homônimo' },
      ],
      responsavel: { tipo: 'EQUIPE', codigo: ' mont03 ', nome: 'Equipe canônica' },
    })).toBe(true);

    expect(restored.snapshot().responsaveis).toEqual([
      { tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Equipe canônica' },
      { tipo: 'OPERADOR', codigo: 'MONT03', nome: 'Operador homônimo' },
    ]);
    expect(restored.snapshot().responsavel).toEqual({
      tipo: 'EQUIPE',
      codigo: 'MONT03',
      nome: 'Equipe canônica',
    });
  });

  it('ends only from the operational state and restores it on failure', () => {
    startBatch();
    state.setHistory([report()]);

    expect(state.beginEnding()).toBe(true);
    expect(state.snapshot().estado).toBe(EstadoBatelada.Encerrando);
    expect(state.beginReport()).toBe(false);

    state.failEnding('Falha ao encerrar');
    expect(state.snapshot()).toEqual(expect.objectContaining({
      estado: EstadoBatelada.BateladaIniciada,
      endingAsyncState: 'erro',
      history: [report()],
    }));

    state.beginEnding();
    state.completeEnding({
      batchId: 'batch-1',
      encerradoEm: new Date(2026, 6, 23, 12),
      ordensEncerradas: ['2', '1'],
    });

    expect(state.snapshot().estado).toBe(EstadoBatelada.Encerrada);
    expect(state.canReport()).toBe(false);
    expect(state.canEnd()).toBe(false);
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

  function startBatch(): void {
    prepareBatch();
    state.setResponsaveis([responsavel()]);
    state.setResponsavel(responsavel());
    state.beginStart();
    state.completeStart({
      batchId: 'batch-1',
      iniciadoEm: new Date(2026, 6, 23, 8, 15),
      ordensIniciadas: ['2', '1'],
    });
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

function report(
  reporteId = 'report-1',
  idempotencyKey = 'idem-1',
  confirmadoEm = new Date(2026, 6, 23, 9),
): ReporteParcialBatelada {
  return {
    reporteId,
    batchId: 'batch-1',
    idempotencyKey,
    confirmadoEm,
    items: [
      {
        orderId: '2',
        ordem: '450002',
        quantidadeAprovada: 8.251,
        quantidadeRetrabalho: 0.501,
        quantidadeRefugo: 1,
        refugoItens: [{ motivoCode: 'R02', descricao: 'Bolha', quantidade: 1 }],
      },
      {
        orderId: '1',
        ordem: '450001',
        quantidadeAprovada: 10.125,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 1,
        refugoItens: [{ motivoCode: 'R01', descricao: 'Apara', quantidade: 1 }],
      },
    ],
  };
}
