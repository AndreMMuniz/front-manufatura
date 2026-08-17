import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { ReportOperacaoService } from '../../report-operacao/services/report-operacao.service';
import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import {
  EncerrarBateladaResponse,
  IniciarBateladaResponse,
  ReporteParcialBateladaRequest,
  ReporteParcialBateladaResponse,
} from '../interfaces/reporta-batelada.dto';
import {
  AreaProducaoBatelada,
  OrdemLiberadaBatelada,
  ResponsavelBatelada,
} from '../models/reporta-batelada.model';

import { ReportaBateladaService } from './reporta-batelada.service';

describe('ReportaBateladaService', () => {
  let service: ReportaBateladaService;
  let session$: BehaviorSubject<unknown>;
  let catalogMock: {
    listarAreas: ReturnType<typeof vi.fn>;
    pesquisarCentros: ReturnType<typeof vi.fn>;
    listarOrdensPorCentro: ReturnType<typeof vi.fn>;
    listarResponsaveis: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    session$ = new BehaviorSubject<unknown>({ user: 'operador' });
    catalogMock = {
      listarAreas: vi.fn(() => of([{ code: '4001', description: 'Produção' }])),
      pesquisarCentros: vi.fn(() => of([workCenter()])),
      listarOrdensPorCentro: vi.fn(() => of([order('1'), order('2')])),
      listarResponsaveis: vi.fn(() => of([responsavel()])),
    };

    const captured = new Map<string, { readonly fingerprint: string; readonly result: object }>();
    TestBed.configureTestingModule({
      providers: [
        ReportaBateladaService,
        { provide: AuthSessionService, useValue: { session$ } },
        { provide: ReportOperacaoService, useValue: catalogMock },
        { provide: ProductionContextCatalogService, useValue: catalogMock },
        {
          provide: OperationalCommandFacade,
          useValue: {
            capture: vi.fn(async (request: { idempotencyKey?: string; payload?: unknown }) => {
              const idempotencyKey =
                request.idempotencyKey ?? globalThis.crypto.randomUUID();
              const fingerprint = JSON.stringify(request.payload);
              const prior = captured.get(idempotencyKey);
              if (prior && prior.fingerprint !== fingerprint) {
                throw new Error('A chave de idempotência já foi usada com outro conteúdo.');
              }
              const result = prior?.result ?? {
                localId: idempotencyKey,
                idempotencyKey,
                payloadHash: 'hash',
                committedAt: '2026-07-30T12:00:00.000Z',
                syncStatus: 'PENDING',
              };
              captured.set(idempotencyKey, { fingerprint, result });
              return result;
            }),
          },
        },
      ],
    });
    service = TestBed.inject(ReportaBateladaService);
  });

  it('delegates Area/CT catalogs and returns defensive copies', async () => {
    const areas = await firstValueFrom(service.listarAreas());
    const centers = await firstValueFrom(service.pesquisarCentros('4001', 'ext'));

    expect(catalogMock.listarAreas).toHaveBeenCalledOnce();
    expect(catalogMock.pesquisarCentros).toHaveBeenCalledWith('4001', 'ext');
    expect(areas).toEqual([{ code: '4001', description: 'Produção' }]);
    expect(centers).toEqual([workCenter()]);
    expect(areas).not.toBe(await firstValueFrom(service.listarAreas()));
  });

  it('lists only released orders for a valid Area/CT and clones every result', async () => {
    const result = await firstValueFrom(service.listarOrdensLiberadas('4001', 'CT-EXT-01'));

    expect(catalogMock.listarOrdensPorCentro).toHaveBeenCalledWith('4001', 'CT-EXT-01');
    expect(result).toEqual([order('1'), order('2')]);
    const source = await firstValueFrom(of([order('1'), order('2')]));
    expect(result[0]).not.toBe(source[0]);
  });

  it('does not query orders without a complete context', async () => {
    expect(await firstValueFrom(service.listarOrdensLiberadas('', 'CT-EXT-01'))).toEqual([]);
    expect(await firstValueFrom(service.listarOrdensLiberadas('4001', ''))).toEqual([]);
    expect(catalogMock.listarOrdensPorCentro).not.toHaveBeenCalled();
  });

  it('lists eligible responsible parties through its semantic boundary', async () => {
    const result = await firstValueFrom(service.listarResponsaveisElegiveis('4001', 'CT-EXT-01'));

    expect(result).toEqual([responsavel()]);
    expect(result[0]).not.toBe(responsavel());
  });

  it('builds one command containing context, responsible party and all ordered items', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T01:15:00.000Z'));
    const request = service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('2'), order('1')],
    );

    expect(request).toEqual({
      batchId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      dataInicio: '2026-08-17',
      horaInicio: '22:15',
      contexto: { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel: { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      ordens: [order('2'), order('1')],
    });
    expect(request.ordens[0]).not.toBe(order('2'));
    vi.useRealTimers();
  });

  it('rejects an empty or duplicated composition at the start boundary', () => {
    expect(() => service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [],
    )).toThrowError('A batelada deve conter ordens únicas.');

    expect(() => service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('1'), order('1')],
    )).toThrowError('A batelada deve conter ordens únicas.');
  });

  it('starts the complete batch atomically and returns a defensive timestamp', async () => {
    const request = service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('1'), order('2')],
    );

    const result = await firstValueFrom(service.iniciarBatelada(request));

    expect(result.batchId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.ordensIniciadas).toEqual(['1', '2']);
    expect(result.iniciadoEm).toBeInstanceOf(Date);
  });

  it.each([
    {
      status: 'RESULTADO_PARCIAL',
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '2', sucesso: false, mensagem: 'Falha Datasul' },
      ],
    },
    {
      status: 'SUCESSO_INTEGRAL',
      resultados: [{ ordemId: '1', sucesso: true }],
    },
  ] satisfies ReadonlyArray<IniciarBateladaResponse>)(
    'rejects a partial or inconsistent start response',
    response => {
      expect(() => service.validarRespostaInicio(response, ['1', '2']))
        .toThrowError('O início conjunto não foi confirmado para todas as ordens.');
    },
  );

  it('rejects an invalid start timestamp', () => {
    expect(() => service.validarRespostaInicio({
      status: 'SUCESSO_INTEGRAL',
      batchId: 'batch-1',
      iniciadoEm: new Date(Number.NaN),
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '2', sucesso: true },
      ],
    }, ['1', '2'])).toThrowError(
      'O início conjunto não foi confirmado para todas as ordens.',
    );
  });

  it.each([
    { field: 'quantidadeAprovada', value: Number.NaN },
    { field: 'quantidadeRetrabalho', value: Number.POSITIVE_INFINITY },
    { field: 'quantidadeRefugo', value: -0.001 },
  ] as const)('rejects invalid $field quantities', ({ field, value }) => {
    const request = reportRequest();
    const invalid = {
      ...request,
      items: request.items.map((item, index) => index === 0 ? { ...item, [field]: value } : item),
    };

    expect(() => service.validarReporteParcial(invalid))
      .toThrowError('As quantidades devem ser números finitos e não negativos.');
  });

  it('requires a globally positive quantity and one reason for each affected order', () => {
    const base = reportRequest();
    const zero = {
      ...base,
      items: base.items.map(item => ({
        ...item,
        quantidadeAprovada: 0,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 0,
        refugoItens: [],
      })),
    };
    expect(() => service.validarReporteParcial(zero))
      .toThrowError('Informe ao menos uma quantidade positiva para salvar o reporte.');

    const wrongScrap = reportRequest({
      first: {
        quantidadeAprovada: 0,
        quantidadeRefugo: 2,
        refugoItens: [
          { motivoCode: 'R01', descricao: 'Apara', quantidade: 1 },
          { motivoCode: 'R02', descricao: 'Outro', quantidade: 1 },
        ],
      },
    });
    expect(() => service.validarReporteParcial(wrongScrap))
      .toThrowError('Informe exatamente um motivo de refugo ou retrabalho para a ordem 450001.');
  });

  it('rejects an empty idempotency key and aggregate overflow', () => {
    expect(() => service.validarReporteParcial({
      ...reportRequest(),
      idempotencyKey: ' ',
    })).toThrowError('A chave de idempotência é obrigatória.');

    const overflow = reportRequest({
      first: {
        quantidadeAprovada: Number.MAX_VALUE,
        quantidadeRetrabalho: Number.MAX_VALUE,
        quantidadeRefugo: 0,
        refugoItens: [],
      },
    });
    expect(() => service.validarReporteParcial(overflow))
      .toThrowError('O total informado excede o limite permitido.');
  });

  it('persists one ordered multi-order report and returns defensive history copies', async () => {
    const inicio = await startBatch();
    const request = reportRequest({ batchId: inicio.batchId });

    const confirmed = await firstValueFrom(service.reportarBateladaParcial(request));
    const history = await firstValueFrom(service.listarReportesBatelada(inicio.batchId));

    expect(confirmed.items.map(item => item.orderId)).toEqual(['1', '2']);
    expect(history).toEqual([confirmed]);
    expect(history[0]).not.toBe(confirmed);
    expect(history[0].items).not.toBe(confirmed.items);
    expect(history[0].confirmadoEm).not.toBe(confirmed.confirmadoEm);
    expect(history[0].items[0].refugoItens).not.toBe(confirmed.items[0].refugoItens);
  });

  it('deduplicates the complete event by batch and idempotency key', async () => {
    const inicio = await startBatch();
    const request = reportRequest({ batchId: inicio.batchId });

    const first = await firstValueFrom(service.reportarBateladaParcial(request));
    const retry = await firstValueFrom(service.reportarBateladaParcial(structuredClone(request)));
    const history = await firstValueFrom(service.listarReportesBatelada(inicio.batchId));

    expect(retry).toEqual(first);
    expect(history).toHaveLength(1);
  });

  it('returns an idempotent retry even after the batch has been closed', async () => {
    const inicio = await startBatch();
    const request = reportRequest({ batchId: inicio.batchId });
    const first = await firstValueFrom(service.reportarBateladaParcial(request));
    await firstValueFrom(service.encerrarBatelada({
      batchId: inicio.batchId,
      orderIds: ['1', '2'],
    }));

    await expect(firstValueFrom(service.reportarBateladaParcial(structuredClone(request))))
      .resolves.toEqual(first);
  });

  it('creates a second partial report when the event has a new idempotency key', async () => {
    const inicio = await startBatch();
    const first = reportRequest({ batchId: inicio.batchId });
    const second = { ...first, idempotencyKey: 'idem-2' };

    await firstValueFrom(service.reportarBateladaParcial(first));
    await firstValueFrom(service.reportarBateladaParcial(second));

    expect(await firstValueFrom(service.listarReportesBatelada(inicio.batchId))).toHaveLength(2);
  });

  it('clones the complete report command before the asynchronous mock processes it', async () => {
    const inicio = await startBatch();
    const request = reportRequest({ batchId: inicio.batchId });
    const pending = firstValueFrom(service.reportarBateladaParcial(request));

    (request.items[0] as { quantidadeAprovada: number }).quantidadeAprovada = 999;
    (request.items[0].refugoItens[0] as { quantidade: number }).quantidade = 999;
    const confirmed = await pending;

    expect(confirmed.items[0].quantidadeAprovada).toBe(10.125);
    expect(confirmed.items[0].refugoItens[0].quantidade).toBe(1.5);
  });

  it('rejects reuse of an idempotency key with a materially different command', async () => {
    const inicio = await startBatch();
    const request = reportRequest({ batchId: inicio.batchId });
    await firstValueFrom(service.reportarBateladaParcial(request));

    const changed = {
      ...request,
      items: request.items.map((item, index) =>
        index === 0 ? { ...item, quantidadeAprovada: item.quantidadeAprovada + 1 } : item),
    };

    await expect(firstValueFrom(service.reportarBateladaParcial(changed)))
      .rejects.toThrow('A chave de idempotência já foi usada com outro conteúdo.');
  });

  it.each([
    {
      status: 'RESULTADO_PARCIAL',
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '2', sucesso: false },
      ],
    },
    {
      status: 'SUCESSO_INTEGRAL',
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '1', sucesso: true },
      ],
    },
    {
      status: 'SUCESSO_INTEGRAL',
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: 'desconhecida', sucesso: true },
      ],
    },
  ] satisfies ReadonlyArray<Partial<ReporteParcialBateladaResponse> & Pick<ReporteParcialBateladaResponse, 'status' | 'resultados'>>)(
    'rejects partial, duplicate or unknown report results',
    response => {
      expect(() => service.validarRespostaReporte({
        reporteId: 'report-1',
        batchId: 'batch-1',
        idempotencyKey: 'idem-1',
        confirmadoEm: new Date(),
        ...response,
      }, reportRequest()))
        .toThrowError('O reporte conjunto não foi confirmado para todas as ordens.');
    },
  );

  it('rejects invalid report and ending timestamps', () => {
    expect(() => service.validarRespostaReporte({
      status: 'SUCESSO_INTEGRAL',
      reporteId: 'report-1',
      batchId: 'batch-1',
      idempotencyKey: 'idem-1',
      confirmadoEm: new Date(Number.NaN),
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '2', sucesso: true },
      ],
    }, reportRequest())).toThrowError(
      'O reporte conjunto não foi confirmado para todas as ordens.',
    );

    expect(() => service.validarRespostaEncerramento({
      status: 'SUCESSO_INTEGRAL',
      batchId: 'batch-1',
      encerradoEm: new Date(Number.NaN),
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '2', sucesso: true },
      ],
    }, 'batch-1', ['1', '2'])).toThrowError(
      'O encerramento conjunto não foi confirmado para todas as ordens.',
    );
  });

  it('clears the preserved stoppage workflow when the session ends', () => {
    service.preservarFluxoParada({ batchId: 'batch-1' } as never);

    session$.next(null);

    expect(service.retomarFluxoParada()).toBeNull();
  });

  it('ends the batch atomically without creating an implicit report', async () => {
    const inicio = await startBatch();

    const encerramento = await firstValueFrom(service.encerrarBatelada({
      batchId: inicio.batchId,
      orderIds: ['1', '2'],
    }));
    const history = await firstValueFrom(service.listarReportesBatelada(inicio.batchId));

    expect(encerramento.batchId).toBe(inicio.batchId);
    expect(encerramento.ordensEncerradas).toEqual(['1', '2']);
    expect(history).toEqual([]);
  });

  it.each([
    {
      status: 'RESULTADO_PARCIAL',
      resultados: [
        { ordemId: '1', sucesso: true },
        { ordemId: '2', sucesso: false },
      ],
    },
    {
      status: 'SUCESSO_INTEGRAL',
      resultados: [{ ordemId: '1', sucesso: true }],
    },
  ] satisfies ReadonlyArray<EncerrarBateladaResponse>)(
    'rejects partial or inconsistent ending responses',
    response => {
      expect(() => service.validarRespostaEncerramento(response, 'batch-1', ['1', '2']))
        .toThrowError('O encerramento conjunto não foi confirmado para todas as ordens.');
    },
  );

  async function startBatch() {
    return firstValueFrom(service.iniciarBatelada(service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('1'), order('2')],
    )));
  }
});

function workCenter() {
  return {
    code: 'CT-EXT-01',
    description: 'Extrusão Linha 01',
    areaCode: '4001',
    area: 'Produção',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
}

function order(id: string): OrdemLiberadaBatelada {
  return {
    id,
    ordem: `45000${id}`,
    itemOp: `PERFIL-${id} / OP-${id}`,
    operacao: '10',
    split: '01',
  };
}

function responsavel(): ResponsavelBatelada {
  return { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' };
}

const _areaTypeCheck: AreaProducaoBatelada = { code: '4001', description: 'Produção' };

function reportRequest(options: {
  readonly batchId?: string;
  readonly first?: Partial<ReporteParcialBateladaRequest['items'][number]>;
} = {}): ReporteParcialBateladaRequest {
  return {
    batchId: options.batchId ?? 'batch-1',
    idempotencyKey: 'idem-1',
    contexto: { areaCode: '4001', workCenterCode: 'CT-01' },
    responsavel: responsavel(),
    dataInicio: new Date(2026, 7, 17, 8),
    horaInicio: '08:00',
    dataFim: new Date(2026, 7, 17, 9),
    horaFim: '09:00',
    finalizarSplit: false,
    items: [
      {
        orderId: '1',
        ordem: '450001',
        quantidadeAprovada: 10.125,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 1.5,
        refugoItens: [{ motivoCode: 'R01', descricao: 'Apara', quantidade: 1.5 }],
        ...options.first,
      },
      {
        orderId: '2',
        ordem: '450002',
        quantidadeAprovada: 8.25,
        quantidadeRetrabalho: 0.5,
        quantidadeRefugo: 0,
        refugoItens: [{ motivoCode: 'R01', descricao: 'Retrabalho', quantidade: 0.5 }],
      },
    ],
  };
}
