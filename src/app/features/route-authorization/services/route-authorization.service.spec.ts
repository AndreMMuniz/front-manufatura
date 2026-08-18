import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PendingAuthorizedRoute } from '../models/route-authorization.model';
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

  it('carrega a ficha autorizada com a identidade do card e operação consultada', async () => {
    const api = {
      get: vi.fn(),
      post: vi.fn().mockReturnValue(of(routeEnvelope(64462))),
      put: vi.fn(),
    };
    const service = new RouteAuthorizationService(api as never);

    const result = await firstValueFrom(service.loadRoute(route(), 10));

    expect(result.route).toMatchObject({
      nrFicha: 64462,
      currentOrder: '372562',
      operationCode: '10',
      itemCode: '30907',
      itemDescription: 'ALAVANCA',
    });
    expect(api.post).toHaveBeenCalledWith(
      '/api/quality-control/route-authorizations/route',
      { nrFicha: 64462, nrOrdemProducao: 372562, codOperacao: 10 },
    );
  });

  it('rejeita a identidade inválida da ficha antes de chamar o BFF', async () => {
    const api = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
    const service = new RouteAuthorizationService(api as never);

    await expect(firstValueFrom(service.loadRoute({ ...route(), sheetNumber: 0 }, 10)))
      .rejects.toThrow('invalid-route-authorization-route');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'numeric', result: 24 }, { resultado: 24 }],
    [{ kind: 'table', tableNumber: 8, optionSequence: 1 }, { nrTabela: 8, seqOpcao: 1 }],
    [{ kind: 'report', report: 'Aprovado' }, { laudo: 'Aprovado' }],
  ] as const)('salva o componente com a representação %o', async (request, representation) => {
    const api = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn().mockReturnValue(of(resultReceipt(representation))),
    };
    const service = new RouteAuthorizationService(api as never);

    const result = await firstValueFrom(service.saveComponent(64462, 1845, 1, request));

    expect(result).toMatchObject({
      sheetNumber: 64462, examCode: 1845, componentCode: 1, withinRange: true,
    });
    expect(api.put).toHaveBeenCalledWith(
      '/api/quality-control/route-authorizations/results',
      { nrFicha: 64462, codExame: 1845, codComponente: 1, ...representation },
    );
  });

  it('rejeita a identidade inválida do componente antes de chamar o BFF', async () => {
    const api = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
    const service = new RouteAuthorizationService(api as never);

    await expect(firstValueFrom(service.saveComponent(64462, 0, 1, {
      kind: 'numeric', result: 24,
    }))).rejects.toThrow('invalid-route-authorization-component');
    expect(api.put).not.toHaveBeenCalled();
  });
});

function route(): PendingAuthorizedRoute {
  return {
    sheetNumber: 64462,
    productionOrderNumber: 372562,
    itemCode: '30907',
    itemDescription: 'ALAVANCA',
    operationSequence: 1,
    statusCode: 2,
    released: false,
    inspected: false,
    totalComponents: 2,
    outOfRangeComponents: 0,
    narrative: '',
  };
}

function routeEnvelope(nrFicha: number) {
  return {
    total: 1, hasNext: false, items: [{
      nrFicha,
      'ds-roteiro': { exames: [{
        codExame: 1845, descricao: 'ALAVANCA', versao: 1, frequencia: 1, amostra: 1,
        nivel: 0, nqa: 0, responsavel: '', observacao: '', componentes: [{
          codExame: 1845, codComponente: 1, descricao: 'MEDIDA', referenciaTecnica: '',
          metodo: '', equipamento: '', tipoResultado: 1, unidade: 'MM', numeroDecimais: 0,
          resultadoMin: 20, resultadoMax: 30, nrTabela: 0,
        }],
      }] },
    }],
  };
}

function resultReceipt(representation: Record<string, unknown>) {
  return {
    total: 1, hasNext: false, items: [{
      nrFicha: 64462,
      codExame: 1845,
      codComponente: 1,
      dentroFaixa: true,
      componentesSalvos: 1,
      componentesTotal: 2,
      ...representation,
    }],
  };
}
