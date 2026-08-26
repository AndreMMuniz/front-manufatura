import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { QualityControlService } from './quality-control';

const orderEnvelope = {
  total: 1, hasNext: false, items: [{ 'ds-ordem-producao': { ordem: [{
    nrOrdemProducao: 372562, codItem: '30907', historicoRoteiros: [{
      nrFicha: 64505, data: null, hora: '', nrOrdemProducao: 372562, codOperacao: 30,
    }], operacoes: [{
      codOperacao: 20, descricaoOperacao: 'USINAR', codItem: '30907',
      centroTrabalho: 'GL-170', codGrupoMaquina: 'TOR-004', splits: [{ numSplit: 1 }],
    }],
  }] } }],
};

const routeEnvelope = {
  total: 1, hasNext: false, items: [{
    nrFicha: 64379, tipoResponsavel: 'OPERADOR', codResponsavel: '00016570',
    'ds-roteiro': { exames: [{
    codExame: 1845, descricao: 'ALAVANCA', versao: 1, frequencia: 60,
    amostra: 2, nivel: 0, nqa: 0, responsavel: 'RPEREIRA', observacao: '',
    componentes: [{ codExame: 1845, codComponente: 1, descricao: 'COTA',
      referenciaTecnica: '', metodo: '', equipamento: 'PAQUÍMETRO', tipoResultado: 4,
      unidade: 'mm', numeroDecimais: 2, resultadoMin: 23.8, resultadoMax: 24.2,
      nrTabela: 0 }],
  }] } }],
};

function createService() {
  const capture = vi.fn().mockResolvedValue({
    localId: 'local-1', idempotencyKey: 'idem-1', payloadHash: 'hash',
    committedAt: '2026-08-08T00:00:00.000Z', syncStatus: 'PENDING',
  });
  const http = {
    get: vi.fn().mockReturnValue(of(orderEnvelope)),
    post: vi.fn().mockReturnValue(of(routeEnvelope)),
  };
  const service = new QualityControlService(
    { capture } as never, undefined, { token: 'jwt' } as never,
    undefined, undefined, undefined, undefined, http as never, undefined,
  );
  return { service, capture, http };
}

describe('QualityControlService real Datasul contracts', () => {
  it('consulta a OP pelo gateway sem fallback mock', async () => {
    const { service, http } = createService();
    await expect(firstValueFrom(service.getProductionOrderOperations('372562'))).resolves.toMatchObject({
      orderNumber: '372562', operations: [{ operationCode: '20', split: '1' }],
      routeHistory: [{ sheetNumber: '64505', operationCode: '30', date: null, time: '' }],
    });
    expect(http.get).toHaveBeenCalledWith('/api/quality-control/orders/372562', expect.anything());
  });

  it.each([
    ['operador', 'OPERADOR', '00018060', { nrOrdemProducao: 372562, codOperacao: 20, codOperador: '00018060' }],
    ['equipe', 'EQUIPE', 'AUT00037', { nrOrdemProducao: 372562, codOperacao: 20, codEquipe: 'AUT00037' }],
  ] as const)('gera a ficha com o código explícito de %s', async (
    _name,
    responsibleType,
    responsibleCode,
    expectedBody,
  ) => {
    const { service, http } = createService();
    const route = await firstValueFrom(service.generateInspectionRoute({
      orderNumber: '372562', moveBalance: false,
      operation: { operationCode: '20', operationDescription: 'USINAR', split: '1',
        itemCode: '30907', itemDescription: '30907', processDescription: 'USINAR' },
      responsibleType,
      responsibleCode,
    }));
    expect(route.routeNumber).toBe('64379');
    expect(route.nrFicha).toBe(64379);
    expect(route).toMatchObject({ responsibleType: 'OPERADOR', responsibleCode: '00016570' });
    expect(route.exams?.[0].components[0]).toMatchObject({ decimalPlaces: 2, minValue: 23.8, maxValue: 24.2 });
    expect(http.post).toHaveBeenCalledWith(
      '/api/quality-control/routes',
      expectedBody,
      expect.anything(),
    );
  });

  it('captura resultado único sem classificar localmente como aprovado', async () => {
    const { service, capture } = createService();
    const response = await firstValueFrom(service.saveMeasurement({
      orderNumber: '372562', nrFicha: 64379, routeNumber: '64379', examId: '64379-1845', examCode: 1845,
      componentId: '64379-1845-1', componentCode: 1, operatorId: 'OP1',
      measurement: { result: 24.01, status: 'RECORDED' },
    }));
    expect(response.measurement).toMatchObject({ result: 24.01, status: 'RECORDED', deliveryStatus: 'PENDING' });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'SAVE_QUALITY_RESULT',
      payload: expect.objectContaining({ orderNumber: '372562', resultado: 24.01 }),
    }));
  });
});
