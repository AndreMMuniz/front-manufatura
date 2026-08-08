import { firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { QualityControlService } from './quality-control';
import { QualityControlWorkflowState } from './quality-control-workflow-state';

describe('finalização da ficha CQ', () => {
  it('considera a ficha completa somente após registrar componentes de todos os exames', () => {
    const state = new QualityControlWorkflowState();
    state.setGeneratedRoute({
      nrFicha: 64379, routeNumber: '64379', processDescription: 'USINAR',
      currentOrder: '372562', operationCode: '20', operationDescription: 'USINAR',
      split: '1', itemCode: '30907', itemDescription: '30907',
    });
    const token = state.beginExamLoad()!;
    state.completeExamLoad(token, [
      { id: 'e1', code: '1', description: 'E1', version: '1', frequency: '1', sample: '1', unit: '', nqa: '0', level: '0', components: [
        { id: 'c1', code: '1', description: 'C1', reference: '', minValue: 0, maxValue: 1, unit: '', sequence: 1, status: 'PENDING' },
      ] },
      { id: 'e2', code: '2', description: 'E2', version: '1', frequency: '1', sample: '1', unit: '', nqa: '0', level: '0', components: [
        { id: 'c2', code: '2', description: 'C2', reference: '', minValue: 0, maxValue: 1, unit: '', sequence: 2, status: 'PENDING' },
      ] },
    ]);
    state.applyMeasurement('e1', 'c1', { result: 1, status: 'RECORDED', commandId: 'result-1' });
    expect(state.completedCount()).toBe(1);
    expect(state.pendingCount()).toBe(1);
    state.applyMeasurement('e2', 'c2', { result: 1, status: 'RECORDED', commandId: 'result-2' });
    expect(state.pendingCount()).toBe(0);
    expect(state.exams().flatMap(exam => state.measurementCommandIds(exam.id)))
      .toEqual(['result-1', 'result-2']);
  });

  it('captura uma única finalização por nrFicha dependente de todos os resultados', async () => {
    const capture = vi.fn().mockResolvedValue({
      localId: 'finish', idempotencyKey: 'finish-1', payloadHash: 'hash',
      committedAt: '2026-08-08T00:00:00.000Z', syncStatus: 'PENDING',
    });
    const service = new QualityControlService({ capture } as never);
    await firstValueFrom(service.finishExam({
      examId: 'route-64379', routeNumber: '64379', idempotencyKey: 'finish-1',
      dependencyIds: ['result-1', 'result-2'],
    }));

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'FINALIZE_QUALITY_ROUTE', aggregateId: '64379',
      dependencyIds: ['result-1', 'result-2'], payload: expect.objectContaining({ nrFicha: 64379 }),
    }));
  });

  it('aplica dentroFaixa somente depois do receipt sincronizado da Outbox', async () => {
    const invalidations = new Subject<never>();
    const service = new QualityControlService(
      { capture: vi.fn() } as never,
      undefined,
      { currentUser: { id: 'OPERADOR1' } } as never,
      undefined,
      { getByIdempotencyKey: vi.fn().mockResolvedValue({
        status: 'SYNCED',
        receipt: { businessResult: { dentroFaixa: false } },
      }) } as never,
      undefined,
      undefined,
      null,
      { invalidations$: invalidations.asObservable() } as never,
    );

    await expect(firstValueFrom(service.watchMeasurementDelivery('result-1'))).resolves.toEqual({
      deliveryStatus: 'SYNCED', withinRange: false,
    });
  });

  it('expõe a confirmação funcional da finalização reconciliada', async () => {
    const invalidations = new Subject<never>();
    const service = new QualityControlService(
      { capture: vi.fn() } as never,
      undefined,
      { currentUser: { id: 'OPERADOR1' } } as never,
      undefined,
      { getByIdempotencyKey: vi.fn().mockResolvedValue({
        status: 'SYNCED',
        receipt: { businessResult: {
          finalizado: true, inspecionado: true, componentesPendentes: 0,
          mensagem: 'Roteiro finalizado',
        } },
      }) } as never,
      undefined,
      undefined,
      null,
      { invalidations$: invalidations.asObservable() } as never,
    );

    await expect(firstValueFrom(service.watchFinalizationDelivery('finish-1'))).resolves.toEqual({
      deliveryStatus: 'SYNCED', finalizado: true, inspecionado: true,
      componentesPendentes: 0, mensagem: 'Roteiro finalizado',
    });
  });
});
