import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { ProductionContext } from '../models/reporte-paradas.model';
import {
  ContextRequestToken,
  ReporteParadasWorkflowState,
} from './reporte-paradas-workflow-state';

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

  it('aplica prefill somente quando Área e CT são integralmente elegíveis', () => {
    expect(state.applyPrefill(
      context,
      [area],
      [center],
      [{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }],
    )).toBe(true);
    expect(state.snapshot()).toEqual(expect.objectContaining({
      area,
      workCenter: center,
      responsibleType: 'OPERADOR',
      responsibleCode: 'OP-001',
      origin: context.origin,
    }));

    state.resetTransient();
    expect(state.applyPrefill(
      { ...context, workCenter: { ...center, active: false } },
      [area],
      [center],
      [],
    )).toBe(false);
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
    expect(view.querySelectionIds).toEqual([]);
  });

  it('limpa dependências ao trocar CT e preserva Área', () => {
    prepareDirtyState();
    const newCenter = { ...center, code: 'CT-EXT-02', description: 'Extrusão 2' };

    state.confirmWorkCenterChange(newCenter);

    expect(state.snapshot().area).toEqual(area);
    expect(state.snapshot().workCenter).toEqual(newCenter);
    expect(state.snapshot().responsibleCode).toBe('');
    expect(state.snapshot().draft).toEqual(state.emptyDraft());
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

    expect(state.acceptContextData(
      currentToken,
      [{ tipo: 'EQUIPE', codigo: 'EMB02', nome: 'Embalagem' }],
      [{ id: 1, code: '01', description: 'Setup' }],
    )).toBe(true);
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

  it('invalida estado transitório e prefill no logout', () => {
    prepareDirtyState();

    session$.next(null);

    expect(state.snapshot()).toEqual(expect.objectContaining({
      area: null,
      workCenter: null,
      origin: undefined,
      dirty: false,
      idempotencyKey: null,
    }));
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
    state.setQuerySelection(['future-stop']);
    return token;
  }
});
