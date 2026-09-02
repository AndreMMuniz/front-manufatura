import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { ClientLogService } from '../../../core/logging/client-log.service';
import { LocalRecordRepository } from '../../../core/offline/repositories/local-record.repository';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { ImmediateCommandDeliveryService } from '../../../core/offline/services/immediate-command-delivery.service';
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
  let currentUser: { readonly id: string } | null;
  let apiPost: ReturnType<typeof vi.fn>;
  let capture: ReturnType<typeof vi.fn>;
  let deliver: ReturnType<typeof vi.fn>;
  let listLocalRecords: ReturnType<typeof vi.fn>;
  let listOutbox: ReturnType<typeof vi.fn>;
  let getOutbox: ReturnType<typeof vi.fn>;
  let clientLogCapture: ReturnType<typeof vi.fn>;
  let catalogMock: {
    listarAreas: ReturnType<typeof vi.fn>;
    pesquisarCentros: ReturnType<typeof vi.fn>;
    listarOrdensPorCentro: ReturnType<typeof vi.fn>;
    listarResponsaveis: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    session$ = new BehaviorSubject<unknown>({ user: 'operador' });
    currentUser = null;
    apiPost = vi.fn((
      _url: string,
      body: { readonly ordens: ReadonlyArray<{ readonly id: string }> },
      idempotencyKey: string,
    ) => of({
      serverRecordId: `datasul:batch-start:${idempotencyKey}`,
      idempotencyKey,
      receivedAt: '2026-08-18T12:00:01.000Z',
      processedAt: '2026-08-18T12:00:01.000Z',
      duplicate: false,
      orderResults: body.ordens.map(ordem => ({
        orderId: ordem.id,
        success: true,
        serverRecordId: `datasul:order:${ordem.id}`,
      })),
    }));
    deliver = vi.fn().mockImplementation(async (localId: string) => localId.startsWith('idem-')
      ? {
        status: 'SYNCED',
        receipt: {
          serverRecordId: `datasul:batch-report:${localId}`,
          receivedAt: '2026-07-30T12:00:01.000Z',
          processedAt: '2026-07-30T12:00:01.000Z',
          duplicate: false,
        },
      }
      : { status: 'PENDING' });
    listLocalRecords = vi.fn().mockResolvedValue([]);
    listOutbox = vi.fn().mockResolvedValue([]);
    getOutbox = vi.fn().mockImplementation(async (_ownerId: string, localId: string) => ({
      localId,
      status: 'RETRY_WAIT',
      lastError: {
        code: 'NETWORK',
        category: 'TRANSIENT',
        userMessage: 'Serviço temporariamente indisponível; uma nova tentativa será realizada.',
      },
    }));
    clientLogCapture = vi.fn();
    catalogMock = {
      listarAreas: vi.fn(() => of([{ code: '4001', description: 'Produção' }])),
      pesquisarCentros: vi.fn(() => of([workCenter()])),
      listarOrdensPorCentro: vi.fn(() => of([order('1'), order('2')])),
      listarResponsaveis: vi.fn(() => of([responsavel()])),
    };

    const captured = new Map<string, { readonly fingerprint: string; readonly result: object }>();
    capture = vi.fn(async (request: { idempotencyKey?: string; payload?: unknown }) => {
      const idempotencyKey = request.idempotencyKey ?? globalThis.crypto.randomUUID();
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
    });
    TestBed.configureTestingModule({
      providers: [
        ReportaBateladaService,
        { provide: AuthenticatedApiService, useValue: { post: apiPost } },
        {
          provide: AuthSessionService,
          useValue: {
            session$,
            get currentUser() { return currentUser; },
          },
        },
        { provide: ReportOperacaoService, useValue: catalogMock },
        { provide: ProductionContextCatalogService, useValue: catalogMock },
        { provide: LocalRecordRepository, useValue: { listByOwner: listLocalRecords } },
        {
          provide: OutboxRepository,
          useValue: { listByOwner: listOutbox, getById: getOutbox },
        },
        { provide: ImmediateCommandDeliveryService, useValue: { deliver } },
        { provide: ClientLogService, useValue: { capture: clientLogCapture } },
        {
          provide: OperationalCommandFacade,
          useValue: { capture },
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

  it('starts the complete batch directly without creating an Outbox command', async () => {
    const request = service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('1'), order('2')],
    );
    apiPost.mockReturnValueOnce(of({
      serverRecordId: 'datasul:batch-start:1',
      idempotencyKey: request.idempotencyKey,
      receivedAt: '2026-08-18T12:00:01.000Z',
      processedAt: '2026-08-18T12:00:02.000Z',
      duplicate: false,
      orderResults: [
        { orderId: '1', success: true, serverRecordId: 'datasul:order:1' },
        { orderId: '2', success: true, serverRecordId: 'datasul:order:2' },
      ],
    }));

    const result = await firstValueFrom(service.iniciarBatelada(request));

    expect(result.batchId).toBe(request.batchId);
    expect(result.ordensIniciadas).toEqual(['1', '2']);
    expect(result.iniciadoEm).toBeInstanceOf(Date);
    expect(result.startCommandId).toBeUndefined();
    expect(result.delivery).toEqual({
      status: 'SYNCED',
      receipt: {
        serverRecordId: 'datasul:batch-start:1',
        receivedAt: '2026-08-18T12:00:01.000Z',
        processedAt: '2026-08-18T12:00:02.000Z',
        duplicate: false,
        orderResults: [
          { orderId: '1', success: true, serverRecordId: 'datasul:order:1' },
          { orderId: '2', success: true, serverRecordId: 'datasul:order:2' },
        ],
      },
    });
    expect(apiPost).toHaveBeenCalledWith('/api/batches/start', {
      batchId: request.batchId,
      contexto: request.contexto,
      responsavel: request.responsavel,
      ordens: request.ordens,
      iniciadoEm: request.occurredAt,
      dataInicio: request.dataInicio,
      horaInicio: request.horaInicio,
    }, request.idempotencyKey);
    expect(capture).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(getOutbox).not.toHaveBeenCalled();
  });

  it('returns a direct Datasul rejection without enqueueing the batch start', async () => {
    const remoteError = {
      code: 'DATASUL_COMMAND_REJECTED',
      category: 'VALIDATION' as const,
      userMessage: 'A ordem já está iniciada.',
    };
    apiPost.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 422,
      error: remoteError,
    })));
    const request = service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('1'), order('2')],
    );

    const result = await firstValueFrom(service.iniciarBatelada(request));

    expect(result.delivery).toEqual({ status: 'ERROR', error: remoteError });
    expect(capture).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(getOutbox).not.toHaveBeenCalled();
  });

  it.each([
    ['status ERROR', { status: 'ERROR' }],
    ['disposição REJECTED', { status: 'PENDING', deliveryDisposition: 'REJECTED' }],
  ])('não restaura um START_BATCH com %s', async (_scenario, outboxState) => {
    currentUser = { id: 'operator-1' };
    const start = persistedBatchStart();
    listLocalRecords.mockResolvedValue([start]);
    listOutbox.mockResolvedValue([{
      ...persistedBatchOutbox(start),
      ...outboxState,
      lastError: {
        code: 'DATASUL_COMMAND_REJECTED',
        category: 'VALIDATION',
        userMessage: 'A ordem já está iniciada.',
      },
    }]);

    await expect(firstValueFrom(service.restaurarBateladaAtiva())).resolves.toBeNull();
  });

  it.each([
    ['sem Outbox', []],
    ['bloqueado por autenticação', [{
      ...persistedBatchOutbox(persistedBatchStart()),
      status: 'BLOCKED_AUTH',
      lastError: {
        code: 'SESSION_REQUIRED',
        category: 'AUTH',
        userMessage: 'Renove a sessão.',
      },
    }]],
    ['sincronizado sem receipt', [{
      ...persistedBatchOutbox(persistedBatchStart()),
      status: 'SYNCED',
    }]],
  ])('não restaura START_BATCH %s como ativo', async (_scenario, entries) => {
    currentUser = { id: 'operator-1' };
    listLocalRecords.mockResolvedValue([persistedBatchStart()]);
    listOutbox.mockResolvedValue(entries);

    await expect(firstValueFrom(service.restaurarBateladaAtiva())).resolves.toBeNull();
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

  it('requires a globally positive quantity and one reason for each order with scrap', () => {
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
      .toThrowError('Informe um motivo de refugo para a ordem 450001.');
  });

  it('allows rework without a scrap reason', () => {
    const request = reportRequest({
      first: {
        quantidadeAprovada: 0,
        quantidadeRetrabalho: 2,
        quantidadeRefugo: 0,
        refugoItens: [],
      },
    });
    const reworkOnly = {
      ...request,
      items: request.items.map(item => ({
        ...item,
        refugoItens: [],
      })),
    };

    expect(() => service.validarReporteParcial(reworkOnly)).not.toThrow();
  });

  it('requires the single reason quantity to equal the order scrap quantity', () => {
    const request = reportRequest({
      first: {
        quantidadeRefugo: 2,
        refugoItens: [{ motivoCode: 'R01', descricao: 'Apara', quantidade: 1 }],
      },
    });

    expect(() => service.validarReporteParcial(request)).toThrowError(
      'A quantidade do motivo deve ser igual à quantidade de refugo da ordem 450001.',
    );
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
    currentUser = { id: 'operator-1' };
    const request = reportRequest({ batchId: inicio.batchId });

    const confirmed = await firstValueFrom(service.reportarBateladaParcial(request));
    currentUser = null;
    const history = await firstValueFrom(service.listarReportesBatelada(inicio.batchId));

    expect(confirmed.items.map(item => item.orderId)).toEqual(['1', '2']);
    const { delivery: _delivery, ...storedReport } = confirmed;
    expect(history).toEqual([storedReport]);
    expect(history[0]).not.toBe(confirmed);
    expect(history[0].items).not.toBe(confirmed.items);
    expect(history[0].confirmadoEm).not.toBe(confirmed.confirmadoEm);
    expect(history[0].items[0].refugoItens).not.toBe(confirmed.items[0].refugoItens);
    expect(confirmed.delivery).toEqual(expect.objectContaining({ status: 'SYNCED' }));
  });

  it('registra persistência e entrega do reporte com a mesma correlação, sem payload', async () => {
    const inicio = await startBatch();
    currentUser = { id: 'operator-1' };

    await firstValueFrom(service.reportarBateladaParcial(
      reportRequest({ batchId: inicio.batchId }),
    ));

    expect(clientLogCapture).toHaveBeenCalledWith({
      level: 'info', category: 'synchronization', event: 'batch_report_persisted',
      correlationId: 'idem-1',
      context: {
        commandType: 'REPORT_BATCH', aggregateType: 'BATCH',
        toStatus: 'PENDING', stage: 'persist',
      },
    });
    expect(clientLogCapture).toHaveBeenCalledWith({
      level: 'info', category: 'synchronization', event: 'batch_report_delivery_observed',
      correlationId: 'idem-1',
      context: {
        commandType: 'REPORT_BATCH', aggregateType: 'BATCH',
        fromStatus: 'PENDING', toStatus: 'SYNCED', stage: 'delivery',
      },
    });
    expect(JSON.stringify(clientLogCapture.mock.calls)).not.toMatch(
      /quantidade|refugo|responsavel|operator-1|payload/,
    );
  });

  it('returns the Datasul rejection instead of classifying the report as pending', async () => {
    const inicio = await startBatch();
    currentUser = { id: 'operator-1' };
    const remoteError = {
      code: 'DATASUL_COMMAND_REJECTED',
      category: 'VALIDATION' as const,
      userMessage: 'A quantidade reportada excede o saldo da ordem 450001.',
    };
    deliver.mockResolvedValueOnce({ status: 'ERROR', error: remoteError });

    const result = await firstValueFrom(service.reportarBateladaParcial(
      reportRequest({ batchId: inicio.batchId }),
    ));

    expect(result.delivery).toEqual({ status: 'ERROR', error: remoteError });
    currentUser = null;
    expect(await firstValueFrom(service.listarReportesBatelada(inicio.batchId))).toEqual([]);
  });

  it('uses pending only after a transient connection failure was persisted', async () => {
    const inicio = await startBatch();
    currentUser = { id: 'operator-1' };
    deliver.mockResolvedValueOnce({ status: 'PENDING' });
    getOutbox.mockResolvedValueOnce({
      status: 'RETRY_WAIT',
      lastError: {
        code: 'NETWORK',
        category: 'TRANSIENT',
        userMessage: 'Serviço temporariamente indisponível; uma nova tentativa será realizada.',
      },
    });

    const result = await firstValueFrom(service.reportarBateladaParcial(
      reportRequest({ batchId: inicio.batchId }),
    ));

    expect(result.delivery).toEqual({ status: 'PENDING' });
  });

  it('does not call an authentication block a pending report', async () => {
    const inicio = await startBatch();
    currentUser = { id: 'operator-1' };
    const authError = {
      code: 'SESSION_REQUIRED',
      category: 'AUTH' as const,
      userMessage: 'A sessão precisa ser renovada para enviar o reporte.',
    };
    deliver.mockResolvedValueOnce({ status: 'PENDING' });
    getOutbox.mockResolvedValueOnce({ status: 'BLOCKED_AUTH', lastError: authError });

    const result = await firstValueFrom(service.reportarBateladaParcial(
      reportRequest({ batchId: inicio.batchId }),
    ));

    expect(result.delivery).toEqual({ status: 'ERROR', error: authError });
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
    currentUser = { id: 'operator-1' };
    const result = await firstValueFrom(service.iniciarBatelada(service.montarComandoInicio(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      responsavel(),
      [order('1'), order('2')],
    )));
    currentUser = null;
    return result;
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

function persistedBatchStart() {
  const payload = {
    batchId: 'batch-rejected',
    contexto: { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
    responsavel: responsavel(),
    ordens: [order('1'), order('2')],
    iniciadoEm: '2026-08-18T12:00:00.000Z',
    dataInicio: '2026-08-18',
    horaInicio: '09:00',
  };
  return {
    localId: 'start-rejected',
    idempotencyKey: 'start-rejected',
    databaseVersion: 1,
    payloadSchemaVersion: 1,
    aggregateType: 'BATCH',
    aggregateId: 'batch-rejected',
    commandType: 'START_BATCH',
    payload,
    canonicalPayload: JSON.stringify(payload),
    payloadHash: 'hash',
    ownerId: 'operator-1',
    businessStatus: 'INICIADA',
    dependencyIds: [],
    occurredAt: '2026-08-18T12:00:00.000Z',
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
  };
}

function persistedBatchOutbox(start: ReturnType<typeof persistedBatchStart>) {
  return {
    ...start,
    status: 'PENDING',
    attemptCount: 0,
  };
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
        refugoItens: [],
      },
    ],
  };
}
