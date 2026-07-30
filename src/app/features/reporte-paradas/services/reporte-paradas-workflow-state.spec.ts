import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import {
  ProductionContext,
  ProductionContextOrigin,
  StopEntry,
} from '../models/reporte-paradas.model';
import { ContextRequestToken, ReporteParadasWorkflowState } from './reporte-paradas-workflow-state';

describe('ReporteParadasWorkflowState', () => {
  let state: ReporteParadasWorkflowState;
  let session$: BehaviorSubject<unknown>;

  const area = { code: '4001', description: 'Produção' };
  const center = {
    code: 'CT-EXT-01',
    description: 'Extrusão',
    areaCode: '4001',
    area: 'Produção',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
  const context: ProductionContext = {
    area,
    workCenter: center,
    origin: {
      type: 'OPERATION_REPORT',
      sourceRoute: '/operation-reporting',
      reportId: 'OP-1',
    },
    preferredResponsible: { tipo: 'OPERADOR', codigo: ' op-001 ', nome: 'Ana Silva' },
    metadata: {
      shift: '1º Turno',
      machineGroup: 'Extrusoras',
      orderIds: ['OP-1'],
    },
  };

  beforeEach(() => {
    session$ = new BehaviorSubject<unknown>({ user: 'operador' });
    TestBed.configureTestingModule({
      providers: [
        ReporteParadasWorkflowState,
        { provide: AuthSessionService, useValue: { session$ } },
      ],
    });
    state = TestBed.inject(ReporteParadasWorkflowState);
  });

  it('vincula tipo, rota e identificador no contrato de origem', () => {
    expectTypeOf<ProductionContextOrigin>().toEqualTypeOf<
      | {
          readonly type: 'OPERATION_REPORT';
          readonly sourceRoute: '/operation-reporting';
          readonly reportId: string;
          readonly batchId?: never;
        }
      | {
          readonly type: 'BATCH_REPORT';
          readonly sourceRoute: '/batch-reporting';
          readonly batchId: string;
          readonly reportId?: never;
        }
    >();
  });

  it('aplica prefill somente quando Área e CT são integralmente elegíveis', () => {
    expect(
      state.applyPrefill(
        context,
        [area],
        [center],
        [{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }],
      ),
    ).toBe(true);
    expect(state.snapshot()).toEqual(
      expect.objectContaining({
        area,
        workCenter: center,
        responsibleType: 'OPERADOR',
        responsibleCode: 'OP-001',
        origin: context.origin,
        metadata: context.metadata,
      }),
    );

    state.resetTransient();
    expect(
      state.applyPrefill(
        { ...context, workCenter: { ...center, active: false } },
        [area],
        [center],
        [],
      ),
    ).toBe(false);
    expect(state.snapshot().area).toBeNull();
    expect(state.snapshot().workCenter).toBeNull();
  });

  it('limpa dependências e chave ao trocar Área, preservando somente a nova Área', () => {
    prepareDirtyState();

    state.confirmAreaChange({ code: '4002', description: 'Qualidade' });

    const view = state.snapshot();
    expect(view.area?.code).toBe('4002');
    expect(view.workCenter).toBeNull();
    expect(view.responsibles).toEqual([]);
    expect(view.reasons).toEqual([]);
    expect(view.draft).toEqual(state.emptyDraft());
    expect(view.dirty).toBe(false);
    expect(view.idempotencyKey).toBeNull();
    expect(view.openStops).toEqual([]);
  });

  it('limpa dependências ao trocar CT e preserva Área', () => {
    prepareDirtyState();
    const newCenter = { ...center, code: 'CT-EXT-02', description: 'Extrusão 2' };

    state.confirmWorkCenterChange(newCenter);

    expect(state.snapshot().area).toEqual(area);
    expect(state.snapshot().workCenter).toEqual(newCenter);
    expect(state.snapshot().responsibleCode).toBe('');
    expect(state.snapshot().draft).toEqual(state.emptyDraft());
    const snapshot = state.snapshot();
    expect(snapshot.origin).toBeUndefined();
    expect(snapshot.metadata).toBeUndefined();
  });

  it('não altera snapshot quando o descarte é cancelado', () => {
    prepareDirtyState();
    const before = state.snapshot();

    state.cancelContextChange();

    expect(state.snapshot()).toEqual(before);
  });

  it('ignora sucesso e erro de gerações anteriores', () => {
    state.confirmAreaChange(area);
    state.confirmWorkCenterChange(center);
    const oldToken = state.beginContextRequest('4001', 'CT-EXT-01');
    const currentToken = state.beginContextRequest('4001', 'CT-EXT-01');

    expect(state.acceptContextData(oldToken, [], [])).toBe(false);
    expect(state.acceptContextError(oldToken, 'erro antigo')).toBe(false);
    expect(state.snapshot().contextError).toBe('');

    expect(
      state.acceptContextData(
        currentToken,
        [{ tipo: 'EQUIPE', codigo: 'EMB02', nome: 'Embalagem' }],
        [{ id: 1, code: '01', description: 'Setup' }],
      ),
    ).toBe(true);
    expect(state.snapshot().responsibles).toHaveLength(1);
  });

  it('gera chave estável para o mesmo rascunho e a renova após confirmação', () => {
    state.confirmAreaChange(area);
    state.confirmWorkCenterChange(center);
    state.updateDraft({ reasonId: 1, startDate: '2026-07-28', startTime: '08:00' });

    const first = state.ensureIdempotencyKey(() => 'idem-1');
    const retry = state.ensureIdempotencyKey(() => 'idem-2');
    state.completeRegistration();
    state.updateDraft({ reasonId: 1, startDate: '2026-07-28', startTime: '09:00' });
    const next = state.ensureIdempotencyKey(() => 'idem-2');

    expect(first).toBe('idem-1');
    expect(retry).toBe('idem-1');
    expect(next).toBe('idem-2');
  });

  it('preserva a chave quando o formulário reemite o mesmo rascunho material', () => {
    prepareDirtyState();

    state.setResponsibleType('OPERADOR');
    state.setResponsibleCode(' op-001 ');
    state.updateDraft({
      reasonId: 1,
      startDate: '2026-07-28',
      startTime: '08:00',
    });

    expect(state.ensureIdempotencyKey(() => 'idem-new')).toBe('idem-current');
  });

  it('invalida estado transitório e prefill no logout', () => {
    prepareDirtyState();

    session$.next(null);

    expect(state.snapshot()).toEqual(
      expect.objectContaining({
        area: null,
        workCenter: null,
        origin: undefined,
        dirty: false,
        idempotencyKey: null,
      }),
    );
  });

  it('aceita somente consulta de abertas da geração e contexto correntes', () => {
    prepareDirtyState();
    const oldToken = state.beginOpenStopsQuery('4001', 'CT-EXT-01');
    const currentToken = state.beginOpenStopsQuery('4001', 'CT-EXT-01');

    expect(state.acceptOpenStops(oldToken, [openStop()])).toBe(false);
    expect(state.acceptOpenStopsError(oldToken, 'erro antigo')).toBe(false);
    expect(state.acceptOpenStops(currentToken, [openStop()])).toBe(true);
    expect(state.snapshot().openStops).toHaveLength(1);
    expect(state.snapshot().openStops[0]).not.toBe(openStop());
  });

  it('seleciona por id estável, sugere agora uma vez e mantém chave no retry idêntico', () => {
    prepareDirtyState();
    const query = state.beginOpenStopsQuery('4001', 'CT-EXT-01');
    state.acceptOpenStops(query, [openStop()]);
    state.selectOpenStop(10, new Date(2026, 6, 28, 9, 45));

    expect(state.snapshot()).toEqual(
      expect.objectContaining({
        selectedStopId: 10,
        finishDraft: { endDate: '2026-07-28', endTime: '09:45' },
      }),
    );
    const first = state.ensureFinishIdempotencyKey(() => 'finish-1');
    state.setFinishing(false);
    const retry = state.ensureFinishIdempotencyKey(() => 'finish-2');
    state.updateFinishDraft({ endTime: '09:45' });
    expect(state.ensureFinishIdempotencyKey(() => 'finish-3')).toBe('finish-1');
    state.updateFinishDraft({ endTime: '09:46' });

    expect(first).toBe('finish-1');
    expect(retry).toBe('finish-1');
    expect(state.ensureFinishIdempotencyKey(() => 'finish-3')).toBe('finish-3');
  });

  it('preserva seleção/rascunho após falha e remove somente a finalizada após sucesso', () => {
    prepareDirtyState();
    const query = state.beginOpenStopsQuery('4001', 'CT-EXT-01');
    state.acceptOpenStops(query, [openStop(), openStop(11)]);
    state.selectOpenStop(10, new Date(2026, 6, 28, 9, 45));
    state.ensureFinishIdempotencyKey(() => 'finish-1');

    const failed = state.beginFinishCommand(10, '4001', 'CT-EXT-01');
    expect(state.acceptFinishError(failed, 'Falha operacional')).toBe(true);
    expect(state.snapshot()).toEqual(
      expect.objectContaining({
        selectedStopId: 10,
        finishError: 'Falha operacional',
        finishIdempotencyKey: 'finish-1',
      }),
    );

    const success = state.beginFinishCommand(10, '4001', 'CT-EXT-01');
    expect(state.acceptFinishSuccess(success, 10)).toBe(true);
    expect(state.snapshot().openStops.map((stop) => stop.id)).toEqual([11]);
    expect(state.snapshot().selectedStopId).toBeNull();
    expect(state.snapshot().finishDraft).toEqual({ endDate: null, endTime: '' });
  });

  it('troca de contexto invalida consulta/comando e limpa lista, seleção e fim', () => {
    prepareDirtyState();
    const query = state.beginOpenStopsQuery('4001', 'CT-EXT-01');
    state.acceptOpenStops(query, [openStop()]);
    state.selectOpenStop(10, new Date(2026, 6, 28, 9, 45));
    const finish = state.beginFinishCommand(10, '4001', 'CT-EXT-01');

    state.confirmWorkCenterChange({ ...center, code: 'CT-EXT-02' });

    expect(state.acceptFinishError(finish, 'erro tardio')).toBe(false);
    expect(state.snapshot()).toEqual(
      expect.objectContaining({
        openStops: [],
        selectedStopId: null,
        queryLoading: false,
        finishError: '',
      }),
    );
  });

  function prepareDirtyState(): ContextRequestToken {
    state.applyPrefill(
      context,
      [area],
      [center],
      [{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }],
    );
    const token = state.beginContextRequest('4001', 'CT-EXT-01');
    state.acceptContextData(
      token,
      [{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }],
      [{ id: 1, code: '01', description: 'Setup' }],
    );
    state.updateDraft({ reasonId: 1, startDate: '2026-07-28', startTime: '08:00' });
    state.ensureIdempotencyKey(() => 'idem-current');
    return token;
  }

  function openStop(id = 10): StopEntry {
    return {
      id,
      context,
      reason: { id: 1, code: '01', description: 'Setup' },
      responsible: { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      startDate: new Date(2026, 6, 28),
      startTime: '08:00',
      programmed: false,
      status: 'EM_ANDAMENTO',
      idempotencyKey: `start-${id}`,
      syncStatus: 'PENDING',
    };
  }
});
