// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  mapAuthorizedComponentResultEnvelope,
  mapAuthorizedFinalizationEnvelope,
  mapPendingRoutesEnvelope,
} from './route-authorization.mapper';

const REAL_RESULT_EXAM_RECEIPT = JSON.parse(readFileSync(new URL(
  '../../../../../project-specs/planodecontrole-api/examples/result-exames-ficha-64378-componente-3-response.json',
  import.meta.url,
), 'utf8')) as unknown;

describe('route authorization mapper', () => {
  it('achata todos os contêineres sem interpretar total como quantidade de fichas', () => {
    expect(mapPendingRoutesEnvelope({
      total: 1, hasNext: false, items: [
        { roteirosEmAnalise: [pending(64382), pending(64442)] },
        { roteirosEmAnalise: [pending(64461)] },
      ],
    }).map(route => route.sheetNumber)).toEqual([64382, 64442, 64461]);
  });

  it('aceita envelope vazio e rejeita ficha malformada', () => {
    expect(mapPendingRoutesEnvelope({ total: 0, hasNext: false, items: [] })).toEqual([]);
    expect(mapPendingRoutesEnvelope({ total: 0, hasNext: false })).toEqual([]);
    expect(mapPendingRoutesEnvelope({ total: 0, hasNext: false, items: [{}] })).toEqual([]);
    expect(() => mapPendingRoutesEnvelope({
      total: 1, hasNext: false, items: [{ roteirosEmAnalise: [{ ...pending(1), codItem: 30907 }] }],
    })).toThrow('invalid-upstream-response');
  });

  it('falha fechado para paginação não suportada e fichas duplicadas', () => {
    expect(() => mapPendingRoutesEnvelope({ total: 1, hasNext: true, items: [] }))
      .toThrow('invalid-upstream-response');
    expect(() => mapPendingRoutesEnvelope({
      total: 2, hasNext: false, items: [
        { roteirosEmAnalise: [pending(64382)] },
        { roteirosEmAnalise: [pending(64382)] },
      ],
    })).toThrow('invalid-upstream-response');
  });

  it('confirma sucesso apenas para a ficha esperada finalizada e sem pendências', () => {
    const envelope = finalization(64461, true, 0);
    expect(mapAuthorizedFinalizationEnvelope(envelope, 64461)).toMatchObject({
      sheetNumber: 64461, finalized: true, pendingComponents: 0,
      message: expect.stringContaining('finalizado'),
      exams: [{ examCode: 164, totalComponents: 6, savedComponents: 6, pendingComponents: 0 }],
    });
    expect(() => mapAuthorizedFinalizationEnvelope(envelope, 99999))
      .toThrow('invalid-upstream-response');
  });

  it('preserva a recusa funcional de finalização para a ficha esperada', () => {
    expect(mapAuthorizedFinalizationEnvelope(finalization(64462, false, 5), 64462))
      .toMatchObject({
        finalized: false,
        message: 'Roteiro 64462 finalizado com AUTORIZACAO',
        totalComponents: 6,
        savedComponents: 1,
        pendingComponents: 5,
        statusCode: 4,
        exams: [{ examCode: 164, totalComponents: 6, savedComponents: 1, pendingComponents: 5 }],
      });
  });

  it('aceita exames ausentes e rejeita totais ou exames incoerentes', () => {
    const withoutExams = finalization(64461, true, 0);
    delete withoutExams.items[0]['ds-finaliza'].roteiro[0].exames;
    expect(mapAuthorizedFinalizationEnvelope(withoutExams, 64461).exams).toEqual([]);

    const pendingExam = finalization(64461, true, 0);
    pendingExam.items[0]['ds-finaliza'].roteiro[0].exames[0].componentesPendentes = 1;
    expect(() => mapAuthorizedFinalizationEnvelope(pendingExam, 64461))
      .toThrow('invalid-upstream-response');

    const inconsistentTotals = finalization(64461, true, 0);
    inconsistentTotals.items[0]['ds-finaliza'].roteiro[0].componentesSalvos = 5;
    expect(() => mapAuthorizedFinalizationEnvelope(inconsistentTotals, 64461))
      .toThrow('invalid-upstream-response');
  });

  it.each([
    [true, { resultado: 24 }],
    [false, { nrTabela: 8, seqOpcao: 1 }],
  ])('mapeia recibo do componente com identidade exata e dentroFaixa %s', (
    withinRange,
    representation,
  ) => {
    const envelope = resultReceipt(64462, 1845, 1, withinRange, representation);

    expect(mapAuthorizedComponentResultEnvelope(envelope, 64462, 1845, 1)).toMatchObject({
      sheetNumber: 64462,
      examCode: 1845,
      componentCode: 1,
      withinRange,
      savedComponents: 1,
      totalComponents: 2,
    });
    expect(() => mapAuthorizedComponentResultEnvelope(envelope, 64462, 1845, 99))
      .toThrow('invalid-upstream-response');
  });

  it('mapeia o recibo real versionado sem aplicar exclusividade da requisição à resposta', () => {
    expect(mapAuthorizedComponentResultEnvelope(
      REAL_RESULT_EXAM_RECEIPT,
      64378,
      1845,
      3,
    )).toEqual({
      sheetNumber: 64378,
      examCode: 1845,
      componentCode: 3,
      withinRange: false,
      savedComponents: 6,
      totalComponents: 6,
    });
  });
});

function pending(nrFicha: number) {
  return {
    liberada: false, componentesTotal: 4, sequenciaOperacao: 1, situacao: 2,
    nrFicha, descricaoItem: 'ALAVANCA', nrOrdemProducao: 372562,
    inspecionado: false, componentesForaFaixa: 1, narrativa: '', codItem: '30907',
  };
}

function finalization(nrFicha: number, finalizado: boolean, componentesPendentes: number) {
  return {
    total: 1, hasNext: false, items: [{ 'ds-finaliza': { roteiro: [{
      componentesTotal: 6, situacao: 4, componentesSalvos: 6 - componentesPendentes, nrFicha,
      mensagem: `Roteiro ${nrFicha} finalizado com AUTORIZACAO`, inspecionado: true,
      componentesForaFaixa: 1, finalizado, componentesPendentes, exames: [{
        componentesTotal: 6, componentesSalvos: 6 - componentesPendentes, nrFicha,
        componentesPendentes, codExame: 164,
      }],
    }] } }],
  };
}

function resultReceipt(
  nrFicha: number,
  codExame: number,
  codComponente: number,
  dentroFaixa: boolean,
  representation: Record<string, unknown>,
) {
  return {
    total: 1, hasNext: false, items: [{
      nrFicha,
      codExame,
      codComponente,
      dentroFaixa,
      componentesSalvos: 1,
      componentesTotal: 2,
      ...representation,
    }],
  };
}
