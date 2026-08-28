import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { AuthSession } from '../../../core/auth/auth.models';
import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { ImmediateCommandDeliveryService } from '../../../core/offline/services/immediate-command-delivery.service';
import { OfflineStorageError } from '../../../core/offline/models/offline-storage-error';
import { LOCAL_RECORDS_STORE, OUTBOX_STORE } from '../../../core/offline/database/database-schema';
import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from '../../../core/offline/database/offline-database';
import { JsonValue, LocalRecord } from '../../../core/offline/models/local-record';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { LocalRecordRepository } from '../../../core/offline/repositories/local-record.repository';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { OutboxEntry } from '../../../core/offline/models/outbox-entry';
import { transactionComplete } from '../../../core/offline/repositories/repository-utils';
import { SyncRetentionRepository } from '../../../core/offline/repositories/sync-retention.repository';
import { SyncRetentionService } from '../../../core/offline/services/sync-retention.service';
import { ReportOperacao } from '../models/report-operacao.model';

import { ReportOperacaoService } from './report-operacao.service';

describe('ReportOperacaoService', () => {
  let service: ReportOperacaoService;
  let apiGet: ReturnType<typeof vi.fn>;
  let capture: ReturnType<typeof vi.fn>;
  let deliver: ReturnType<typeof vi.fn>;
  let listLocalRecords: ReturnType<typeof vi.fn>;
  let listOutbox: ReturnType<typeof vi.fn>;
  let session$: BehaviorSubject<AuthSession | null>;

  beforeEach(() => {
    session$ = new BehaviorSubject<AuthSession | null>({
      user: { id: '1', nome: 'Andre', login: 'andre', permissoes: [] },
      mode: 'ONLINE',
      token: 'token',
      authenticatedAt: new Date(),
      lastValidatedAt: new Date(),
    });
    const center = {
      code: 'CT-EXT-01', description: 'Extrusão', areaCode: '4001', area: 'Produção',
      machineGroup: 'Extrusoras', establishment: '101', active: true,
    };
    const orders = [
      { id: '450001|OP-10458|10|01', ordem: '450001', itemOp: 'PERFIL-100 / OP-10458', operacao: '10', split: '01', areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      { id: '450002|OP-10459|20|01', ordem: '450002', itemOp: 'PERFIL-200 / OP-10459', operacao: '20', split: '01', areaCode: '4001', workCenterCode: 'CT-EXT-01' },
    ];
    apiGet = vi.fn((url: string, query?: Record<string, unknown>) => {
      if (url === '/api/production-areas') return of([
        { code: '4001', description: 'Produção' }, { code: '4002', description: 'Qualidade' },
      ]);
      if (url === '/api/work-centers') {
        return of(query?.['areaCode'] === '4001' && (!query?.['term'] || query['term'] === 'ext') ? [center] : []);
      }
      if (url === '/api/production-orders') return of(query?.['areaCode'] === '4001' ? orders : []);
      if (url.startsWith('/api/production-orders/450001/')) return of({
        ordem: '450001', op: 'OP-10458', split: '01', item: 'PERFIL-100',
        descricao: 'Perfil', unidade: 'PC', roteiro: '10 - Extrusão', quantidadeOrdem: 500,
        quantidadeSaldo: 320, linha: 'Extrusão', ct: 'CT-EXT-01', grupoMaquina: 'Extrusoras',
        operador: 'Ana Silva', equipe: '', turno: '1º Turno',
      });
      if (url.startsWith('/api/production-orders/')) return throwError(() => new Error('OP não encontrada'));
      if (url === '/api/operational-responsibles') return of(query?.['areaCode'] === '4001' ? [
        { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
        { tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Montagem' },
      ] : []);
      if (url === '/api/teams') return of(query?.['areaCode'] === '4001' ? [{
        codigo: 'EQ0007', descricao: 'Equipe Sete', turno: '2', operadores: [],
      }] : []);
      return of([]);
    });
    capture = vi.fn(async (request: { idempotencyKey?: string }) => {
      const idempotencyKey =
        request.idempotencyKey ?? '123e4567-e89b-42d3-a456-426614174000';
      return {
        localId: idempotencyKey,
        idempotencyKey,
        payloadHash: 'hash',
        committedAt: '2026-07-30T12:00:00.000Z',
        syncStatus: 'PENDING',
      };
    });
    deliver = vi.fn().mockResolvedValue({ status: 'PENDING' });
    listLocalRecords = vi.fn().mockResolvedValue([]);
    listOutbox = vi.fn().mockResolvedValue([]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthSessionService,
          useValue: {
            session$,
            get currentUser() {
              return session$.value?.user ?? null;
            },
          },
        },
        { provide: AuthenticatedApiService, useValue: { get: apiGet } },
        { provide: LocalRecordRepository, useValue: { listByOwner: listLocalRecords } },
        { provide: OutboxRepository, useValue: { listByOwner: listOutbox } },
        {
          provide: OperationalCommandFacade,
          useValue: { capture },
        },
        {
          provide: ImmediateCommandDeliveryService,
          useValue: { deliver },
        },
      ],
    });
    service = TestBed.inject(ReportOperacaoService);
  });

  it('restaura somente versões ativas e projeta o status atual da Outbox', async () => {
    const start = persistedStart();
    const synced = persistedReport('report-synced', 2, '2026-08-28T09:00:00.000Z');
    const rejected = persistedReport('report-rejected', 5, '2026-08-28T10:00:00.000Z');
    const correction = {
      ...persistedReport('report-correction', 3, '2026-08-28T11:00:00.000Z'),
      logicalOccurredAt: rejected.occurredAt,
      supersedesLocalId: rejected.localId,
    };
    listLocalRecords.mockResolvedValue([start, synced, rejected, correction]);
    listOutbox.mockResolvedValue([
      outboxProjection(synced, 'SYNCED'),
      {
        ...outboxProjection(rejected, 'ERROR'),
        deliveryDisposition: 'SUPERSEDED',
        supersededByLocalId: correction.localId,
      },
      {
        ...outboxProjection(correction, 'RETRY_WAIT'),
        supersedesLocalId: rejected.localId,
      },
    ]);

    const restored = await firstValueFrom(service.restaurarOperacaoAtiva());

    expect(listLocalRecords).toHaveBeenCalledWith('1');
    expect(listOutbox).toHaveBeenCalledWith('1');
    expect(restored?.reportes).toEqual([
      expect.objectContaining({ id: 'report-synced', quantidadeAprovada: 2, deliveryStatus: 'SYNCED' }),
      expect.objectContaining({ id: 'report-correction', quantidadeAprovada: 3, deliveryStatus: 'PENDING' }),
    ]);
    expect(restored?.reportes.map(report => report.id)).not.toContain('report-rejected');
  });

  it('restaura um reporte ativo rejeitado com status ERROR', async () => {
    const report = persistedReport('report-error', 1, '2026-08-28T09:00:00.000Z');
    listLocalRecords.mockResolvedValue([persistedStart(), report]);
    listOutbox.mockResolvedValue([outboxProjection(report, 'ERROR')]);

    const restored = await firstValueFrom(service.restaurarOperacaoAtiva());

    expect(restored?.reportes).toEqual([
      expect.objectContaining({ id: report.localId, deliveryStatus: 'ERROR' }),
    ]);
  });

  it('mantém START e REPORT restauráveis enquanto não existe END_OPERATION sincronizado', async () => {
    const database = new OfflineDatabase(() => new IDBFactory(), OFFLINE_DATABASE_CONFIG);
    const localRecords = new LocalRecordRepository(database);
    const outbox = new OutboxRepository(database);
    const retention = new SyncRetentionService(
      outbox,
      new SyncRetentionRepository(database),
      () => new Date('2026-08-28T13:00:00.000Z'),
      { currentUser: session$.value?.user ?? null } as AuthSessionService,
    );
    listLocalRecords.mockImplementation(ownerId => localRecords.listByOwner(ownerId));
    listOutbox.mockImplementation(ownerId => outbox.listByOwner(ownerId));

    try {
      await seedActiveOperationWithReport(database);
      await retention.cleanupOwner('1');

      const restored = await firstValueFrom(service.restaurarOperacaoAtiva());

      expect(restored?.operation.ordem).toBe('450001');
      expect(restored?.reportes).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('falha sem devolver a projeção se o owner muda durante a leitura da Outbox', async () => {
    let resolveOutbox!: (entries: readonly unknown[]) => void;
    listLocalRecords.mockResolvedValue([persistedStart()]);
    listOutbox.mockImplementation(() => new Promise(resolve => { resolveOutbox = resolve; }));

    const restoration = firstValueFrom(service.restaurarOperacaoAtiva());
    await vi.waitFor(() => expect(listOutbox).toHaveBeenCalledOnce());
    session$.next({
      user: { id: '2', nome: 'Outra', login: 'outra', permissoes: [] },
      mode: 'ONLINE',
      token: 'token-2',
      authenticatedAt: new Date(),
      lastValidatedAt: new Date(),
    });
    resolveOutbox([]);

    await expect(restoration).rejects.toMatchObject({
      name: 'OfflineStorageError',
      code: 'PAYLOAD_INVALID',
    } satisfies Partial<OfflineStorageError>);
  });

  it('loads a valid operation from the Datasul HTTP boundary', async () => {
    const orders = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));
    const result = await firstValueFrom(service.carregarOrdemSelecionada(orders[0]));

    expect(result.sucesso).toBe(true);
    expect(result.operacao?.item).toBe('PERFIL-100');
    expect(result.operacao?.quantidadeSaldo).toBe(320);
  });

  it('propagates an unknown operation API error', async () => {
    await expect(firstValueFrom(
      service.carregarOrdemSelecionada({
        id: 'removed-order',
        ordem: '999999',
        itemOp: 'ITEM-REMOVIDO',
        operacao: '999',
        split: '01',
      }),
    )).rejects.toThrow('OP não encontrada');
  });

  it('lists deterministic production areas with fresh immutable values', async () => {
    const first = await firstValueFrom(service.listarAreasProducao());
    const second = await firstValueFrom(service.listarAreasProducao());

    expect(first).toEqual([
      { code: '4001', description: 'Produção' },
      { code: '4002', description: 'Qualidade' },
    ]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('searches only active work centers belonging to the selected area', async () => {
    await expect(firstValueFrom(service.pesquisarCentrosTrabalho('4001', 'ext'))).resolves.toEqual([
      expect.objectContaining({ code: 'CT-EXT-01', areaCode: '4001', active: true }),
    ]);
    await expect(firstValueFrom(service.pesquisarCentrosTrabalho('4001', 'qualidade'))).resolves.toEqual([]);
    await expect(firstValueFrom(service.pesquisarCentrosTrabalho('area-invalida', ''))).resolves.toEqual([]);
  });

  it('lists only released orders for a coherent area and work center relation', async () => {
    const orders = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));

    expect(orders).toHaveLength(2);
    expect(orders.map(order => order.id)).toEqual(['450001|OP-10458|10|01', '450002|OP-10459|20|01']);
    expect(orders[0]).toEqual({
      id: '450001|OP-10458|10|01',
      ordem: '450001',
      itemOp: 'PERFIL-100 / OP-10458',
      operacao: '10',
      split: '01',
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
    });
  });

  it('returns an empty list for a valid center without orders and rejects mismatched context', async () => {
    await expect(firstValueFrom(service.listarOrdensPorCentro('4002', 'CT-CQ-01'))).resolves.toEqual([]);
    await expect(firstValueFrom(service.listarOrdensPorCentro('4002', 'CT-EXT-01'))).resolves.toEqual([]);
    await expect(firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-MNT-01'))).resolves.toEqual([]);
  });

  it('does not leak mutations between order-list queries', async () => {
    const first = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));
    const second = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect('$selected' in first[0]).toBe(false);
  });

  it('blocks reporting without operation start', () => {
    expect(service.validarReporte(baseOperacao({ quantidadeAprovada: 1 }))).toBe('Inicie a operação antes de reportar.');
  });

  it('blocks reporting without produced quantity', () => {
    expect(service.validarReporte(baseOperacaoIniciada())).toBe('Informe ao menos uma quantidade produzida.');
  });

  it('blocks negative quantities', () => {
    expect(service.validarReporte(baseOperacaoIniciada({ quantidadeAprovada: -1 }))).toBe('As quantidades não podem ser negativas.');
  });

  it('blocks quantities above available balance', () => {
    expect(service.validarReporte(baseOperacaoIniciada({ quantidadeAprovada: 321 }))).toBe(
      'A quantidade produzida não pode ultrapassar o saldo da OP.',
    );
  });

  it('allows valid reporting payloads', () => {
    expect(service.validarReporte(baseOperacaoIniciada({ quantidadeAprovada: 10 }))).toBe('');
  });

  it('validates partial quantities against the accumulated total and order balance', () => {
    const operacao = baseOperacaoIniciada({
      quantidadeAprovada: 300,
      quantidadeRetrabalho: 10,
    });

    expect(service.validarReporteParcial(operacao, 5, 0, 0)).toBe('');
    expect(service.validarReporteParcial(operacao, 11, 0, 0)).toBe(
      'A quantidade acumulada não pode ultrapassar o saldo da OP.',
    );
    expect(service.validarReporteParcial(operacao, 0, 0, 0)).toBe(
      'Informe ao menos uma quantidade produzida.',
    );
    expect(service.validarReporteParcial(operacao, Number.NaN, 0, 0)).toBe(
      'As quantidades não podem ser negativas.',
    );
  });

  it('accepts decimal quantities that reach the balance after three-decimal rounding', () => {
    const operacao = baseOperacaoIniciada({
      quantidadeSaldo: 0.3,
      quantidadeAprovada: 0.1,
    });

    expect(service.validarReporteParcial(operacao, 0.2, 0, 0)).toBe('');
  });

  it('accepts a partial scrap quantity without requiring reasons', () => {
    const operacao = baseOperacaoIniciada();

    expect(service.validarReporteParcial(operacao, 0, 0, 1.5)).toBe('');
  });

  it('lists operators and teams as selectable operation responsibles', async () => {
    const responsaveis = await firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01'));

    expect(responsaveis).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }),
      expect.objectContaining({ tipo: 'EQUIPE', codigo: 'MONT03' }),
    ]));
    expect(responsaveis).toHaveLength(2);
    await expect(firstValueFrom(service.listarResponsaveis('4002', 'CT-CQ-01'))).resolves.toEqual([]);
    await expect(firstValueFrom(service.listarResponsaveis('', 'CT-CQ-01'))).resolves.toEqual([]);
  });

  it('carrega somente operadores ou equipes conforme o tipo definido pela abertura', async () => {
    const listarPorTipo = service.listarResponsaveis.bind(service) as unknown as (
      areaCode: string,
      workCenterCode: string,
      tipo: 'OPERADOR' | 'EQUIPE',
    ) => ReturnType<ReportOperacaoService['listarResponsaveis']>;
    await expect(firstValueFrom(
      listarPorTipo('4001', 'CT-EXT-01', 'OPERADOR'),
    )).resolves.toEqual([
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
    ]);
    await expect(firstValueFrom(
      listarPorTipo('4001', 'CT-EXT-01', 'EQUIPE'),
    )).resolves.toEqual([
      { tipo: 'EQUIPE', codigo: 'EQ0007', nome: 'Equipe Sete' },
    ]);
    expect(apiGet).toHaveBeenCalledWith('/api/teams', {
      areaCode: '4001', workCenterCode: 'CT-EXT-01',
    });
  });

  it('não esconde falha do catálogo canônico', async () => {
    apiGet.mockReturnValueOnce(throwError(() => new Error('catálogo indisponível')));
    await expect(firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01')))
      .rejects.toThrow('catálogo indisponível');
  });

  it('returns the same ERP report for retries with the same idempotency key', async () => {
    const request = {
      idempotencyKey: 'retry-1',
      ordem: '450001',
      op: 'OP-10458',
      split: '01',
      areaCode: '4001',
      finalizarSplit: false,
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
      dataInicio: new Date(2026, 6, 30, 8),
      horaInicio: '08:00',
      dataFim: new Date(2026, 6, 30, 9),
      horaFim: '09:00',
      operador: 'Ana Silva',
      equipe: '',
      tipoResponsavel: 'OPERADOR' as const,
      codigoResponsavel: 'OP-001',
      ct: 'CT-EXT-01',
    };

    const first = await firstValueFrom(service.reportarOperacao(request));
    const retry = await firstValueFrom(service.reportarOperacao(request));

    expect(retry.apontamentoId).toBe(first.apontamentoId);
    expect(retry.reportadoEm).toEqual(first.reportadoEm);
  });

  it('persists a report before awaiting its remote delivery for the same local ID', async () => {
    const order: string[] = [];
    const confirmation = {
      localId: 'report-local-id',
      idempotencyKey: 'report-key',
      payloadHash: 'hash',
      committedAt: '2026-07-30T12:00:00.000Z',
      syncStatus: 'PENDING',
    };
    const receipt = {
      serverRecordId: 'erp-report-1',
      receivedAt: '2026-07-30T12:00:01.000Z',
      processedAt: '2026-07-30T12:00:02.000Z',
      duplicate: false,
    };
    capture.mockImplementation(async () => {
      order.push('capture');
      return confirmation;
    });
    deliver.mockImplementation(async (localId: string) => {
      order.push(`deliver:${localId}`);
      return { status: 'SYNCED', receipt } as const;
    });

    const result = await firstValueFrom(service.reportarOperacao(reportRequest()));

    expect(order).toEqual(['capture', `deliver:${confirmation.localId}`]);
    expect(capture).toHaveBeenCalledOnce();
    expect(result).toEqual({
      apontamentoId: confirmation.localId,
      reportadoEm: expect.any(Date),
      delivery: { status: 'SYNCED', receipt },
    });
  });

  it('returns a pending delivery after capturing the report once', async () => {
    deliver.mockResolvedValue({ status: 'PENDING' });

    const result = await firstValueFrom(service.reportarOperacao(reportRequest()));

    expect(capture).toHaveBeenCalledOnce();
    expect(result.delivery).toEqual({ status: 'PENDING' });
  });

  it('returns a failed delivery after capturing the report once', async () => {
    const error = {
      code: 'INVALID_REPORT',
      category: 'VALIDATION',
      userMessage: 'O reporte foi rejeitado.',
    };
    deliver.mockResolvedValue({ status: 'ERROR', error });

    const result = await firstValueFrom(service.reportarOperacao(reportRequest()));

    expect(capture).toHaveBeenCalledOnce();
    expect(result.delivery).toEqual({ status: 'ERROR', error });
  });

  it('propaga a identidade do reporte substituído pela captura de correção', async () => {
    capture.mockResolvedValue({
      localId: 'report-correction',
      aggregateId: '450001|OP-10458|01',
      idempotencyKey: 'report-correction',
      payloadHash: 'hash-correction',
      committedAt: '2026-08-28T10:05:00.000Z',
      syncStatus: 'PENDING',
      supersedesLocalId: 'report-rejected',
    });

    const result = await firstValueFrom(service.reportarOperacao(reportRequest()));

    expect(result).toMatchObject({
      apontamentoId: 'report-correction',
      supersedesLocalId: 'report-rejected',
      delivery: { status: 'PENDING' },
    });
  });

  it('freezes area and work center in the END_OPERATION payload', async () => {
    await firstValueFrom(service.encerrarOperacao({
      idempotencyKey: 'end-372561-10-1',
      dependencyIds: ['report-final-local-id'],
      ordem: '372561',
      op: '10',
      split: '1',
      areaCode: '4104',
      ct: 'PRE-006-02',
      dataFim: new Date('2026-08-19T13:30:00.000Z'),
      horaFim: '10:30',
    }));

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'END_OPERATION',
      dependencyIds: ['report-final-local-id'],
      payload: {
        ordem: '372561',
        op: '10',
        split: '1',
        areaCode: '4104',
        ct: 'PRE-006-02',
      },
    }));
  });
});

function reportRequest() {
  return {
    idempotencyKey: 'report-key',
    ordem: '450001',
    op: 'OP-10458',
    split: '01',
    areaCode: '4001',
    finalizarSplit: false,
    quantidadeAprovada: 1,
    quantidadeRetrabalho: 0,
    quantidadeRefugo: 0,
    refugoItens: [],
    dataInicio: new Date(2026, 6, 30, 8),
    horaInicio: '08:00',
    dataFim: new Date(2026, 6, 30, 9),
    horaFim: '09:00',
    operador: 'Ana Silva',
    equipe: '',
    tipoResponsavel: 'OPERADOR' as const,
    codigoResponsavel: 'OP-001',
    ct: 'CT-EXT-01',
  };
}

function persistedStart() {
  return {
    localId: 'start-1',
    idempotencyKey: 'start-1',
    aggregateType: 'OPERATION',
    aggregateId: '450001|OP-10458|01',
    commandType: 'START_OPERATION',
    ownerId: '1',
    occurredAt: '2026-08-28T08:00:00.000Z',
    createdAt: '2026-08-28T08:00:00.000Z',
    deliveryDisposition: 'ACTIVE' as const,
    payload: {
      area: { code: '4001', description: 'Produção' },
      workCenter: {
        code: 'CT-EXT-01', description: 'Extrusão', areaCode: '4001', area: 'Produção',
        machineGroup: 'Extrusoras', establishment: '101', active: true,
      },
      operation: baseOperacao(),
      tipoResponsavel: 'OPERADOR',
      codigoResponsavel: 'OP-001',
      operador: 'Ana Silva',
      equipe: '',
    },
  };
}

function persistedReport(localId: string, quantidadeAprovada: number, createdAt: string) {
  return {
    localId,
    idempotencyKey: localId,
    aggregateType: 'OPERATION',
    aggregateId: '450001|OP-10458|01',
    commandType: 'REPORT_OPERATION',
    ownerId: '1',
    occurredAt: createdAt,
    createdAt,
    deliveryDisposition: 'ACTIVE' as const,
    payload: {
      quantidadeAprovada,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
      dataInicio: '2026-08-28T08:00:00.000Z',
      horaInicio: '08:00',
      dataFim: createdAt,
      horaFim: '09:00',
      finalizarSplit: false,
    },
  };
}

async function seedActiveOperationWithReport(database: OfflineDatabase): Promise<void> {
  const records = [
    activeLocalRecord(persistedStart()),
    activeLocalRecord(persistedReport('report-active', 1, '2026-08-28T09:00:00.000Z')),
  ];
  const transaction = await database.createTransaction([LOCAL_RECORDS_STORE, OUTBOX_STORE], 'readwrite');
  const completed = transactionComplete(transaction);
  const localStore = transaction.objectStore(LOCAL_RECORDS_STORE);
  const outboxStore = transaction.objectStore(OUTBOX_STORE);

  for (const record of records) {
    localStore.add(record);
    outboxStore.add(activeOutboxEntry(record));
  }
  await completed;
}

function activeLocalRecord(
  record: ReturnType<typeof persistedStart> | ReturnType<typeof persistedReport>,
): LocalRecord<JsonValue> {
  return {
    ...record,
    databaseVersion: 4,
    payloadSchemaVersion: 1,
    canonicalPayload: JSON.stringify(record.payload),
    payloadHash: `hash-${record.localId}`,
    dependencyIds: [],
    updatedAt: record.createdAt,
    payload: record.payload as JsonValue,
  };
}

function activeOutboxEntry(record: LocalRecord<JsonValue>): OutboxEntry<JsonValue> {
  return {
    localId: record.localId,
    idempotencyKey: record.idempotencyKey,
    payloadSchemaVersion: record.payloadSchemaVersion,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    commandType: record.commandType,
    payload: record.payload,
    canonicalPayload: record.canonicalPayload,
    payloadHash: record.payloadHash,
    ownerId: record.ownerId,
    status: 'SYNCED',
    dependencyIds: record.dependencyIds,
    attemptCount: 1,
    occurredAt: record.occurredAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    synchronizedAt: record.createdAt,
  };
}

function outboxProjection(
  record: ReturnType<typeof persistedReport>,
  status: 'SYNCED' | 'ERROR' | 'RETRY_WAIT',
) {
  return {
    localId: record.localId,
    ownerId: record.ownerId,
    status,
    deliveryDisposition: record.deliveryDisposition,
  };
}

function baseOperacao(overrides: Partial<ReportOperacao> = {}): ReportOperacao {
  return {
    ordem: '450001',
    op: 'OP-10458',
    split: '01',
    item: 'CORT-1200',
    descricao: 'Riscador profissional para porcelanato',
    unidade: 'PC',
    roteiro: 'MONO-001',
    quantidadeOrdem: 500,
    quantidadeSaldo: 320,
    linha: 'Linha Montagem 02',
    horaInicio: '',
    horaFim: '',
    quantidadeAprovada: 0,
    quantidadeRetrabalho: 0,
    quantidadeRefugo: 0,
    ct: 'CT-ESTAMP-01',
    grupoMaquina: 'Prensas Hidraulicas',
    operador: 'Joao Pereira',
    equipe: 'Equipe A',
    turno: '1o Turno',
    ...overrides,
  };
}

function baseOperacaoIniciada(overrides: Partial<ReportOperacao> = {}): ReportOperacao {
  return baseOperacao({
    dataInicio: new Date(2026, 5, 30),
    horaInicio: '08:00',
    dataFim: new Date(2026, 5, 30),
    horaFim: '08:30',
    ...overrides,
  });
}
