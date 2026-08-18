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
    ['representação ausente', resultEnvelope(resultItem({}))],
    ['representações misturadas', resultEnvelope(resultItem({ resultado: 1, laudo: 'Aprovado' }))],
    ['opção tabelada incompleta', resultEnvelope(resultItem({ nrTabela: 8 }))],
  ])('rejeita recibo ResultExames com %s', async (_name, envelope) => {
    const client = clientRespondingWith(envelope);

    await expect(client.saveResult({
      nrFicha: 64462, codExame: 1845, codComponente: 3, codUsuario: 'Mjocelio', resultado: 24.01,
    })).rejects.toMatchObject({ status: 502, code: 'invalid-upstream-response' });
  });
});
