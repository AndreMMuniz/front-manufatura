// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  QualityControlDatasulClient,
  readQualityControlDatasulConfig,
} from './quality-control-datasul-client';

const ENV = {
  DATASUL_BASE_URL: 'https://datasul.example.test',
  DATASUL_COMPANY_ID: '1',
  DATASUL_INTEGRATION_USER: 'integracao',
  DATASUL_INTEGRATION_PASSWORD: 'segredo-tecnico',
  DATASUL_REQUEST_TIMEOUT_MS: '1000',
};

const REAL_RESULT_EXAM_RECEIPT = JSON.parse(readFileSync(new URL(
  '../project-specs/planodecontrole-api/examples/result-exames-ficha-64378-componente-3-response.json',
  import.meta.url,
), 'utf8')) as unknown;

function resultEnvelope(item: Record<string, unknown>) {
  return { total: 1, hasNext: false, items: [item] };
}

function resultItem(representation: Record<string, unknown>) {
  return {
    nrFicha: 64462,
    codExame: 1845,
    codComponente: 3,
    dentroFaixa: true,
    componentesSalvos: 1,
    componentesTotal: 2,
    ...representation,
  };
}

function clientRespondingWith(value: unknown): QualityControlDatasulClient {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  return new QualityControlDatasulClient(
    readQualityControlDatasulConfig(ENV), transport, () => new AbortController().signal,
  );
}

describe('QualityControlDatasulClient ResultExames receipt', () => {
  it('aceita tipoResultado 4 gravado com classificação de faixa ainda não informada', async () => {
    const receipt = {
      total: 1,
      hasNext: false,
      items: [{
        observacao: '',
        componentesSalvos: 1,
        resultado: 23.8,
        dtResultado: '2026-08-26',
        resultadoMinDefinido: 23.8,
        dentroFaixa: null,
        codResponsavel: 'mjocelio',
        nrTabela: 0,
        codComponente: 1,
        seqComp: 1,
        componentesTotal: 6,
        resultadoMax: 24.2,
        nrFicha: 64558,
        laudo: '',
        resultadoMaxDefinido: 24.2,
        numeroTeste: 1,
        tipoResultado: 4,
        codItem: '30907',
        codExame: 1845,
      }],
    };
    const client = clientRespondingWith(receipt);

    await expect(client.saveResult({
      nrFicha: 64558,
      codExame: 1845,
      codComponente: 1,
      codUsuario: 'mjocelio',
      resultado: 23.8,
      resultadoMax: 24.2,
    })).resolves.toEqual(receipt);
  });

  it('aceita o recibo real versionado com campos auxiliares e representações combinadas', async () => {
    const client = clientRespondingWith(REAL_RESULT_EXAM_RECEIPT);

    await expect(client.saveResult({
      nrFicha: 64378, codExame: 1845, codComponente: 3,
      nrTabela: 8, seqOpcao: 1, codUsuario: 'Mjocelio',
    })).resolves.toEqual(REAL_RESULT_EXAM_RECEIPT);
  });

  it.each([
    ['numérico', { resultado: 24.01 }],
    ['tabelado', { nrTabela: 8, seqOpcao: 1 }],
    ['laudo', { laudo: 'Aprovado' }],
  ])('aceita recibo %s com uma representação de resultado', async (_name, representation) => {
    const client = clientRespondingWith(resultEnvelope(resultItem(representation)));

    await expect(client.saveResult({
      nrFicha: 64462, codExame: 1845, codComponente: 3, codUsuario: 'Mjocelio',
      ...representation,
    })).resolves.toEqual(resultEnvelope(resultItem(representation)));
  });

  it.each([
    ['mais de um item', { total: 1, hasNext: false, items: [resultItem({ resultado: 1 }), resultItem({ resultado: 2 })] }],
    ['identidade não positiva', resultEnvelope(resultItem({ resultado: 1, codComponente: 0 }))],
    ['dentroFaixa não booleano', resultEnvelope(resultItem({ resultado: 1, dentroFaixa: 'sim' }))],
    ['totais incoerentes', resultEnvelope(resultItem({ resultado: 1, componentesSalvos: 3, componentesTotal: 2 }))],
  ])('rejeita recibo ResultExames com %s', async (_name, envelope) => {
    const client = clientRespondingWith(envelope);

    await expect(client.saveResult({
      nrFicha: 64462, codExame: 1845, codComponente: 3, codUsuario: 'Mjocelio', resultado: 24.01,
    })).rejects.toMatchObject({ status: 502, code: 'invalid-upstream-response' });
  });
});
