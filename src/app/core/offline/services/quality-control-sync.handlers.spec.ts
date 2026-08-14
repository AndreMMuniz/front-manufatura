import { HttpHeaders } from '@angular/common/http';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

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
      code: 'QUALITY_ROUTE_NOT_FINALIZED', category: 'VALIDATION',
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
    }, new AbortController().signal)).rejects.toThrow('invalid-quality-control-receipt');
  });
});
