import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { RouteAuthorizationService } from './route-authorization.service';

describe('RouteAuthorizationService', () => {
  it('consulta o BFF somente com ordem e operação', async () => {
    const api = { get: vi.fn().mockReturnValue(of({ total: 0, hasNext: false, items: [] })), post: vi.fn() };
    const service = new RouteAuthorizationService(api as never);

    await expect(firstValueFrom(service.search(372562, 10))).resolves.toEqual([]);
    expect(api.get).toHaveBeenCalledWith('/api/quality-control/route-authorizations', {
      nrOrdemProducao: 372562, opCodigo: 10,
    });
  });

  it('não envia identidade nem empresa ao finalizar', async () => {
    const api = { get: vi.fn(), post: vi.fn().mockReturnValue(of({
      total: 1, hasNext: false, items: [{ 'ds-finaliza': { roteiro: [{
        componentesTotal: 1, situacao: 4, componentesSalvos: 1, nrFicha: 64461,
        mensagem: 'Finalizado', inspecionado: true, componentesForaFaixa: 1,
        finalizado: true, componentesPendentes: 0, exames: [],
      }] } }],
    })) };
    const service = new RouteAuthorizationService(api as never);

    await firstValueFrom(service.finalize(64461));
    expect(api.post).toHaveBeenCalledWith(
      '/api/quality-control/route-authorizations/finalize', { nrFicha: 64461 },
    );
  });
});
