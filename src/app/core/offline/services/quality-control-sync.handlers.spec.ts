import { HttpHeaders } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { normalizeCommandError } from '../models/sync-error';
import { FinalizeQualityRouteSyncHandler, SaveQualityResultSyncHandler } from './quality-control-sync.handlers';

const request = {
  localId: 'local', idempotencyKey: 'idem-1', payloadHash: 'hash', payloadSchemaVersion: 1,
  aggregateType: 'QUALITY_EXAM', aggregateId: '64379', commandType: 'SAVE_QUALITY_RESULT',
  canonicalPayload: '{}', occurredAt: '2026-08-08T00:00:00.000Z',
};

describe('quality-control Outbox handlers', () => {
  it('envia resultado único com Bearer/idempotência e conserva dentroFaixa remoto', async () => {
    const put = vi.fn().mockReturnValue(of({
      total: 1, hasNext: false, items: [{
        nrFicha: 64379, codExame: 1845, codComponente: 1,
        dentroFaixa: false, componentesSalvos: 1, componentesTotal: 6,
      }],
    }));
    const handler = new SaveQualityResultSyncHandler(
      { put } as never,
      { token: 'jwt-em-memoria' } as never,
    );
    const result = await handler.send({
      ...request,
      payload: { nrFicha: 64379, codExame: 1845, codComponente: 1, resultado: 24.01 },
    }, new AbortController().signal);

    expect(put).toHaveBeenCalledWith('/api/quality-control/results', {
      nrFicha: 64379, codExame: 1845, codComponente: 1, resultado: 24.01,
    }, expect.objectContaining({ headers: expect.any(HttpHeaders) }));
    expect(result.businessResult).toMatchObject({ dentroFaixa: false });
  });

  it('envia os dois valores medidos do tipoResultado 4', async () => {
    const put = vi.fn().mockReturnValue(of({
      total: 1, hasNext: false, items: [{
        nrFicha: 64558, codExame: 1845, codComponente: 1,
        dentroFaixa: true, componentesSalvos: 1, componentesTotal: 6,
      }],
    }));
    const handler = new SaveQualityResultSyncHandler(
      { put } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    await handler.send({
      ...request,
      payload: {
        nrFicha: 64558, codExame: 1845, codComponente: 1,
        resultado: 23.9, resultadoMax: 24.1,
      },
    }, new AbortController().signal);

    expect(put).toHaveBeenCalledWith('/api/quality-control/results', {
      nrFicha: 64558, codExame: 1845, codComponente: 1,
      resultado: 23.9, resultadoMax: 24.1,
    }, expect.objectContaining({ headers: expect.any(HttpHeaders) }));
  });

  it('reconcilia tipoResultado 4 quando o Datasul ainda não informa dentroFaixa', async () => {
    const put = vi.fn().mockReturnValue(of({
      total: 1,
      hasNext: false,
      items: [{
        nrFicha: 64558,
        codExame: 1845,
        codComponente: 1,
        resultado: 23.8,
        resultadoMax: 24.2,
        dentroFaixa: null,
        componentesSalvos: 1,
        componentesTotal: 6,
      }],
    }));
    const handler = new SaveQualityResultSyncHandler(
      { put } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    const result = await handler.send({
      ...request,
      payload: {
        nrFicha: 64558,
        codExame: 1845,
        codComponente: 1,
        resultado: 23.8,
        resultadoMax: 24.2,
      },
    }, new AbortController().signal);

    expect(result.businessResult).toEqual({
      dentroFaixa: null,
      componentesSalvos: 1,
      componentesTotal: 6,
    });
  });

  it('envia laudo do tipoResultado 3 sem convertê-lo em número ou opção tabelada', async () => {
    const put = vi.fn().mockReturnValue(of({
      total: 1, hasNext: false, items: [{
        nrFicha: 64391, codExame: 2000, codComponente: 10,
        dentroFaixa: false, componentesSalvos: 1, componentesTotal: 3,
      }],
    }));
    const handler = new SaveQualityResultSyncHandler(
      { put } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    await handler.send({
      ...request,
      payload: { nrFicha: 64391, codExame: 2000, codComponente: 10, laudo: '0' },
    }, new AbortController().signal);

    expect(put).toHaveBeenCalledWith('/api/quality-control/results', {
      nrFicha: 64391, codExame: 2000, codComponente: 10, laudo: '0',
    }, expect.objectContaining({ headers: expect.any(HttpHeaders) }));
  });

  it('rejeita payload local inválido antes de iniciar o PUT do resultado', async () => {
    const put = vi.fn();
    const handler = new SaveQualityResultSyncHandler(
      { put } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    await expect(handler.send({
      ...request,
      payload: {
        nrFicha: 64379, codExame: 1845, codComponente: 1,
        resultado: 24.01, laudo: 'valor incompatível',
      },
    }, new AbortController().signal)).rejects.toMatchObject({
      category: 'VALIDATION',
      deliveryOutcome: 'REJECTED',
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejeita nrFicha local inválido antes de iniciar o PUT de finalização', async () => {
    const put = vi.fn();
    const handler = new FinalizeQualityRouteSyncHandler(
      { put } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    await expect(handler.send({
      ...request, commandType: 'FINALIZE_QUALITY_ROUTE', payload: { nrFicha: 0 },
    }, new AbortController().signal)).rejects.toMatchObject({
      category: 'VALIDATION',
      deliveryOutcome: 'REJECTED',
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('não reconcilia finalizado false como sucesso', async () => {
    const put = vi.fn().mockReturnValue(of({
      total: 1, hasNext: false, items: [{ 'ds-finaliza': { roteiro: [{
        nrFicha: 64379, finalizado: false, inspecionado: false,
        componentesTotal: 1, componentesSalvos: 0,
        componentesPendentes: 1, mensagem: 'Ainda há pendências',
      }] } }],
    }));
    const handler = new FinalizeQualityRouteSyncHandler(
      { put } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    await expect(handler.send({
      ...request, commandType: 'FINALIZE_QUALITY_ROUTE', payload: { nrFicha: 64379 },
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'QUALITY_ROUTE_NOT_FINALIZED', category: 'VALIDATION', deliveryOutcome: 'REJECTED',
    });
  });

  it('não reconcilia receipt sem envelope completo', async () => {
    const handler = new SaveQualityResultSyncHandler(
      { put: vi.fn().mockReturnValue(of({ items: [{
        nrFicha: 64379, codExame: 1845, codComponente: 1,
        dentroFaixa: true, componentesSalvos: 1, componentesTotal: 1,
      }] })) } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    await expect(handler.send({
      ...request,
      payload: { nrFicha: 64379, codExame: 1845, codComponente: 1, resultado: 24.01 },
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_QUALITY_CONTROL_RECEIPT',
      category: 'TRANSIENT',
      deliveryOutcome: 'UNCERTAIN',
    });
  });

  it('trata recibo malformado depois de HTTP 200 como entrega incerta', async () => {
    const handler = new SaveQualityResultSyncHandler(
      { put: vi.fn().mockReturnValue(of({ items: [{
        nrFicha: 64379, codExame: 1845, codComponente: 1,
        dentroFaixa: true, componentesSalvos: 1, componentesTotal: 1,
      }] })) } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    const error = await handler.send({
      ...request,
      payload: { nrFicha: 64379, codExame: 1845, codComponente: 1, resultado: 24.01 },
    }, new AbortController().signal).catch(reason => reason);

    expect(normalizeCommandError(error)).toMatchObject({
      deliveryOutcome: 'UNCERTAIN',
    });
  });

  it('propaga a classificação e a mensagem pública devolvidas pelo gateway de qualidade', async () => {
    const handler = new SaveQualityResultSyncHandler(
      { put: vi.fn().mockReturnValue(throwError(() => ({
        status: 502,
        error: {
          code: 'invalid-upstream-response',
          category: 'TRANSIENT',
          deliveryOutcome: 'UNCERTAIN',
          userMessage: 'O destino respondeu, mas a gravação ainda precisa ser confirmada.',
          correlationId: 'corr-quality-1',
        },
      }))) } as never,
      { token: 'jwt-em-memoria' } as never,
    );

    await expect(handler.send({
      ...request,
      payload: { nrFicha: 64379, codExame: 1845, codComponente: 1, resultado: 24.01 },
    }, new AbortController().signal)).rejects.toEqual({
      status: 502,
      code: 'invalid-upstream-response',
      category: 'TRANSIENT',
      deliveryOutcome: 'UNCERTAIN',
      userMessage: 'O destino respondeu, mas a gravação ainda precisa ser confirmada.',
      correlationId: 'corr-quality-1',
    });
  });
});
