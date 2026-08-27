// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  mapInspectionRouteEnvelope,
  mapInspectionRouteEnvelopeForSheet,
  mapProductionOrderEnvelope,
} from './datasul-quality-control.mapper';

const REAL_GENERATED_OPERATOR_ROUTE = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../project-specs/planodecontrole-api/examples/roteiros-372562-operacao-10-ficha-64235-response.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as unknown;

describe('Datasul quality-control mapper', () => {
  it('mapeia ordem, operações e splits na ordem recebida', () => {
    expect(mapProductionOrderEnvelope({
      total: 1, hasNext: false, items: [{
        'ds-ordem-producao': { ordem: [{
          nrOrdemProducao: 372562, codItem: '30907',
          descricaoItem: 'ALAVANCA CORTADOR MASTER 75/90 - USINADO',
          historicoRoteiros: [
            { nrFicha: 64505, data: null, hora: '', nrOrdemProducao: 372562, codOperacao: 30 },
            { nrFicha: 64501, data: '2026-08-25', hora: '14:30', nrOrdemProducao: 372562, codOperacao: 30 },
          ],
          operacoes: [{
            codOperacao: 20, descricaoOperacao: 'USINAR', codItem: '30907',
            centroTrabalho: 'GL-170', codGrupoMaquina: 'TOR-004',
            splits: [{ numSplit: 2 }],
          }],
        }] },
      }],
    })).toMatchObject({
      orderNumber: '372562',
      operations: [{
        operationCode: '20', split: '2', operationDescription: 'USINAR',
        itemDescription: 'ALAVANCA CORTADOR MASTER 75/90 - USINADO',
      }],
      routeHistory: [
        { sheetNumber: '64505', orderNumber: '372562', operationCode: '30', date: null, time: '' },
        { sheetNumber: '64501', orderNumber: '372562', operationCode: '30', date: '2026-08-25', time: '14:30' },
      ],
    });
  });

  it('aceita contrato legado sem histórico e limita a apresentação aos 20 primeiros registros', () => {
    const order = {
      nrOrdemProducao: 372562, codItem: '30907', operacoes: [],
      historicoRoteiros: Array.from({ length: 21 }, (_, index) => ({
        nrFicha: 64000 + index,
        data: null,
        hora: '',
        nrOrdemProducao: 372562,
        codOperacao: 10,
      })),
    };
    const result = mapProductionOrderEnvelope({
      total: 1, hasNext: false, items: [{ 'ds-ordem-producao': { ordem: [order] } }],
    });
    expect(result.routeHistory).toHaveLength(20);
    expect(result.routeHistory.at(-1)?.sheetNumber).toBe('64019');

    delete (order as { historicoRoteiros?: unknown }).historicoRoteiros;
    expect(mapProductionOrderEnvelope({
      total: 1, hasNext: false, items: [{ 'ds-ordem-producao': { ordem: [order] } }],
    }).routeHistory).toEqual([]);
  });

  it('mantém operação finalizada quando o Datasul omite splits', () => {
    expect(mapProductionOrderEnvelope({
      total: 1, hasNext: false, items: [{ 'ds-ordem-producao': { ordem: [{
        nrOrdemProducao: 372562,
        codItem: '30907',
        descricaoItem: 'ALAVANCA CORTADOR MASTER 75/90 - USINADO',
        operacoes: [{
          codOperacao: 10,
          descricaoOperacao: 'CORTAR / REMACHAR ALAVANCA',
          codItem: '30907',
          operacaoFinalizada: true,
        }],
      }] } }],
    }).operations).toEqual([{
      operationCode: '10',
      operationDescription: 'CORTAR / REMACHAR ALAVANCA',
      itemCode: '30907',
      itemDescription: 'ALAVANCA CORTADOR MASTER 75/90 - USINADO',
      processDescription: 'CORTAR / REMACHAR ALAVANCA',
    }]);
  });

  it('mantém a consulta da ordem quando um registro do histórico é inválido', () => {
    const result = mapProductionOrderEnvelope({
      total: 1, hasNext: false, items: [{ 'ds-ordem-producao': { ordem: [{
        nrOrdemProducao: 372562, codItem: '30907', operacoes: [{
          codOperacao: 20, descricaoOperacao: 'USINAR', codItem: '30907',
          centroTrabalho: 'GL-170', codGrupoMaquina: 'TOR-004', splits: [{ numSplit: 1 }],
        }],
        historicoRoteiros: [
          { nrFicha: 64505, data: null, hora: '', nrOrdemProducao: 372562, codOperacao: 30 },
          { nrFicha: 0, data: null, hora: '', nrOrdemProducao: 372562, codOperacao: 30 },
        ],
      }] } }],
    });

    expect(result).toMatchObject({
      orderNumber: '372562',
      operations: [{ operationCode: '20', split: '1' }],
      routeHistory: [{ sheetNumber: '64505', operationCode: '30' }],
    });
  });

  it.each([
    [{ nrFicha: 0, data: null, hora: '', nrOrdemProducao: 372562, codOperacao: 10 }],
    [{ nrFicha: 64505, data: null, hora: '', nrOrdemProducao: 999999, codOperacao: 10 }],
    [{ nrFicha: 64505, data: '26/08/2026', hora: '', nrOrdemProducao: 372562, codOperacao: 10 }],
    [{ nrFicha: 64505, data: null, hora: '', nrOrdemProducao: 372562, codOperacao: 0 }],
  ])('ignora item inválido no histórico de roteiros', historyItem => {
    expect(mapProductionOrderEnvelope({
      total: 1, hasNext: false, items: [{ 'ds-ordem-producao': { ordem: [{
        nrOrdemProducao: 372562, codItem: '30907', operacoes: [],
        historicoRoteiros: [historyItem],
      }] } }],
    }).routeHistory).toEqual([]);
  });

  it('mantém nrFicha, resultado único, decimais e opções tabeladas', () => {
    const result = mapInspectionRouteEnvelope({
      total: 1, hasNext: false, items: [{
        nrFicha: 64379, tipoResponsavel: 'EQUIPE', codResponsavel: 'AUT00037',
        'ds-roteiro': { exames: [{
        codExame: 1845, descricao: 'ALAVANCA', versao: 1, frequencia: 60,
        amostra: 2, nivel: 0, nqa: 0, responsavel: 'RPEREIRA', observacao: '',
        componentes: [{
          codExame: 1845, codComponente: 3, descricao: 'CHANFRO',
          referenciaTecnica: '', metodo: '', equipamento: 'VISUAL', tipoResultado: 2,
          unidade: '', numeroDecimais: 0, resultadoMin: 0, resultadoMax: 0,
          nrTabela: 8, opcoesResultado: [
            { nrTabela: 8, seqOpcao: 1, codComponente: 3, codExame: 1845, descricao: 'SIM' },
            { nrTabela: 8, seqOpcao: 2, codComponente: 3, codExame: 1845, descricao: 'NÃO' },
          ],
        }],
      }] } }],
    }, {
      orderNumber: '372562',
      operation: {
        operationCode: '20', operationDescription: 'USINAR', itemCode: '30907',
        itemDescription: '30907', processDescription: 'USINAR', split: '1',
      },
    });

    expect(result.route.nrFicha).toBe(64379);
    expect(result.route).toMatchObject({
      responsibleType: 'EQUIPE',
      responsibleCode: 'AUT00037',
    });
    expect(result.route.exams).toHaveLength(1);
    expect(result.exams[0].components[0]).toMatchObject({
      componentCode: 3, decimalPlaces: 0, tableNumber: 8,
      equipment: 'VISUAL',
      resultOptions: [{ sequence: 1, description: 'SIM' }, { sequence: 2, description: 'NÃO' }],
    });
  });

  it('mapeia a ficha real quando o Datasul identifica o responsável como Operador', () => {
    const result = mapInspectionRouteEnvelope(REAL_GENERATED_OPERATOR_ROUTE, {
      orderNumber: '372562',
      operation: {
        operationCode: '10',
        operationDescription: 'CORTAR / REMACHAR ALAVANCA',
        itemCode: '30907',
        itemDescription: 'ALAVANCA CORTADOR MASTER 75/90 - USINADO',
        processDescription: 'CORTAR / REMACHAR ALAVANCA',
      },
    });

    expect(result.route).toMatchObject({
      nrFicha: 64235,
      routeNumber: '64235',
      responsibleType: 'OPERADOR',
      responsibleCode: '00018060',
    });
    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].components).toHaveLength(6);
  });

  it('seleciona somente a ficha solicitada para a análise autorizada', () => {
    const envelope = {
      total: 2, hasNext: false, items: [routeItem(64379), routeItem(64462)],
    };
    const context = {
      orderNumber: '372562',
      operation: {
        operationCode: '10', operationDescription: 'CORTE', itemCode: '30907',
        itemDescription: 'ALAVANCA', processDescription: 'CORTE', split: '1',
      },
    };

    expect(mapInspectionRouteEnvelopeForSheet(envelope, context, 64462).route.nrFicha)
      .toBe(64462);
    expect(() => mapInspectionRouteEnvelopeForSheet(envelope, context, 99999))
      .toThrow('invalid-upstream-response');
  });

  it('preserva tipo 3 como laudo sem transformar limites zerados em referência', () => {
    const result = mapInspectionRouteEnvelope({
      total: 1, hasNext: false, items: [{ nrFicha: 64399, 'ds-roteiro': { exames: [{
        codExame: 2000, descricao: 'CORTE LASER', versao: 1, frequencia: 60,
        amostra: 2, nivel: 0, nqa: 0, responsavel: 'RPEREIRA', observacao: '',
        componentes: [{
          codExame: 2000, codComponente: 10,
          descricao: 'ESPESSURA CHAPA CONF. DESENHO', referenciaTecnica: '',
          metodo: '', equipamento: 'PAQUÍMETRO', tipoResultado: 3,
          unidade: '', numeroDecimais: 0, resultadoMin: 0, resultadoMax: 0,
          nrTabela: 0,
        }],
      }] } }],
    }, {
      orderNumber: '372569',
      operation: {
        operationCode: '10', operationDescription: 'CORTE', itemCode: 'ITEM',
        itemDescription: 'ITEM', processDescription: 'CORTE', split: '1',
      },
    });

    expect(result.exams[0].components[0]).toMatchObject({
      resultType: 3,
      reference: '',
      minValue: 0,
      maxValue: 0,
    });
  });

  it('rejeita envelope vazio ou desconhecido', () => {
    expect(() => mapProductionOrderEnvelope({ total: 0, hasNext: false, items: [] }))
      .toThrow('invalid-upstream-response');
  });

  it('rejeita opção tabelada pertencente a outro componente', () => {
    expect(() => mapInspectionRouteEnvelope({
      total: 1, hasNext: false, items: [{ nrFicha: 64379, 'ds-roteiro': { exames: [{
        codExame: 1845, descricao: 'E', versao: 1, frequencia: 1, amostra: 1,
        nivel: 0, nqa: 0, responsavel: '', observacao: '', componentes: [{
          codExame: 1845, codComponente: 3, descricao: 'C', referenciaTecnica: '',
          metodo: '', equipamento: '', tipoResultado: 2, unidade: '', numeroDecimais: 0,
          resultadoMin: 0, resultadoMax: 0, nrTabela: 8, opcoesResultado: [{
            nrTabela: 8, seqOpcao: 1, codComponente: 99, codExame: 1845, descricao: 'SIM',
          }],
        }],
      }] } }],
    }, {
      orderNumber: '372562',
      operation: { operationCode: '20', operationDescription: 'USINAR', itemCode: '30907',
        itemDescription: '', processDescription: 'USINAR', split: '1' },
    })).toThrow('invalid-upstream-response');
  });
});

function routeItem(nrFicha: number) {
  return {
    nrFicha,
    'ds-roteiro': { exames: [{
      codExame: 1845, descricao: 'ALAVANCA', versao: 1, frequencia: 60,
      amostra: 2, nivel: 0, nqa: 0, responsavel: '', observacao: '', componentes: [{
        codExame: 1845, codComponente: 1, descricao: 'MEDIDA', referenciaTecnica: '',
        metodo: 'PAQUÍMETRO', equipamento: '', tipoResultado: 1, unidade: 'MM',
        numeroDecimais: 2, resultadoMin: 20, resultadoMax: 30, nrTabela: 0,
      }],
    }] },
  };
}
