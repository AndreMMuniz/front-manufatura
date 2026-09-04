import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, defer, delay, forkJoin, from, map, of, switchMap } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { ClientLogService } from '../../../core/logging/client-log.service';
import { deliveryDispositionOf } from '../../../core/offline/models/delivery-disposition';
import type { ImmediateDeliveryResult } from '../../../core/offline/models/immediate-delivery-result';
import type {
  OutboxEntry,
  PersistedSyncError,
  RemoteCommandReceipt,
} from '../../../core/offline/models/outbox-entry';
import { normalizeCommandError } from '../../../core/offline/models/sync-error';
import { LocalRecordRepository } from '../../../core/offline/repositories/local-record.repository';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { IdempotencyService } from '../../../core/offline/services/idempotency.service';
import { ImmediateCommandDeliveryService } from '../../../core/offline/services/immediate-command-delivery.service';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { ReportOperacaoService } from '../../report-operacao/services/report-operacao.service';
import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';
import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import {
  EncerrarBateladaRequest,
  EncerrarBateladaResponse,
  IniciarBateladaRequest,
  IniciarBateladaResponse,
  ReporteParcialBateladaRequest,
  ReporteParcialBateladaResponse,
} from '../interfaces/reporta-batelada.dto';
import {
  arredondarQuantidadeBatelada,
  ContextoBatelada,
  EncerramentoBatelada,
  InicioBatelada,
  InicioBateladaEntregue,
  ItemReporteBatelada,
  OrdemLiberadaBatelada,
  ReporteParcialBatelada,
  ReporteParcialBateladaEntregue,
  ResponsavelBatelada,
  EstadoBatelada,
} from '../models/reporta-batelada.model';
import type { ReportaBateladaWorkflowSnapshot } from './reporta-batelada-workflow-state';

interface BatchMockRecord {
  readonly orderIds: ReadonlyArray<string>;
  encerrada: boolean;
}

interface DirectBatchStartReceipt extends RemoteCommandReceipt {
  readonly idempotencyKey: string;
}

class InvalidDirectBatchStartReceiptError extends Error {
  constructor() {
    super('invalid-direct-batch-start-receipt');
    this.name = 'InvalidDirectBatchStartReceiptError';
  }
}

@Injectable({ providedIn: 'root' })
export class ReportaBateladaService {
  private readonly reportCatalog = inject(ReportOperacaoService);
  private readonly productionCatalog = inject(ProductionContextCatalogService);
  private readonly api = inject(AuthenticatedApiService);
  private readonly authSession = inject(AuthSessionService, { optional: true });
  private readonly clientLogs = inject(ClientLogService);
  private readonly idempotency = inject(IdempotencyService);
  private readonly commands = inject(OperationalCommandFacade);
  private readonly immediateDelivery = inject(ImmediateCommandDeliveryService);
  private readonly localRecords = inject(LocalRecordRepository);
  private readonly outbox = inject(OutboxRepository);
  private readonly batches = new Map<string, BatchMockRecord>();
  private readonly reportsByBatch = new Map<string, ReadonlyArray<ReporteParcialBatelada>>();
  private stoppedWorkflow: ReportaBateladaWorkflowSnapshot | null = null;

  constructor() {
    this.authSession?.session$.subscribe(session => {
      if (session === null) {
        this.clearSessionState();
      }
    });
  }

  preservarFluxoParada(snapshot: ReportaBateladaWorkflowSnapshot): void {
    this.stoppedWorkflow = snapshot;
  }

  retomarFluxoParada(): ReportaBateladaWorkflowSnapshot | null {
    const snapshot = this.stoppedWorkflow;
    this.stoppedWorkflow = null;
    return snapshot;
  }

  descartarFluxoParada(): void {
    this.stoppedWorkflow = null;
  }

  restaurarBateladaAtiva(): Observable<ReportaBateladaWorkflowSnapshot | null> {
    const ownerId = this.authSession?.currentUser?.id.trim();
    if (!ownerId) return of(null);
    return from(Promise.all([
      this.localRecords.listByOwner(ownerId),
      this.outbox.listByOwner(ownerId),
    ])).pipe(
      switchMap(([records, outboxEntries]) => {
        const outboxById = new Map(
          outboxEntries
            .filter(entry => entry.ownerId === ownerId)
            .map(entry => [entry.localId, entry] as const),
        );
        const activeRecords = records.filter(record => {
          if (
            record.ownerId !== ownerId
            || deliveryDispositionOf(record.deliveryDisposition) !== 'ACTIVE'
          ) return false;
          const entry = outboxById.get(record.localId);
          return !entry || deliveryDispositionOf(entry.deliveryDisposition) === 'ACTIVE';
        });
        const starts = [...activeRecords]
          .filter(record => record.commandType === 'START_BATCH'
            && this.isRestorableStart(outboxById.get(record.localId)))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        const start = starts.find(candidate =>
          !activeRecords.some(record => record.aggregateId === candidate.aggregateId && (
            record.commandType === 'END_BATCH'
            || (record.commandType === 'REPORT_BATCH'
              && (record.payload as Record<string, unknown>)['finalizarSplit'] === true)
          )));
        if (!start) return of(null);
        const payload = start.payload as Record<string, unknown>;
        const contexto = payload['contexto'] as Record<string, unknown> | undefined;
        const responsavel = payload['responsavel'] as ResponsavelBatelada | undefined;
        const ordens = Array.isArray(payload['ordens'])
          ? payload['ordens'] as OrdemLiberadaBatelada[]
          : [];
        const areaCode = typeof contexto?.['areaCode'] === 'string' ? contexto['areaCode'] : '';
        const workCenterCode =
          typeof contexto?.['workCenterCode'] === 'string' ? contexto['workCenterCode'] : '';
        if (!areaCode || !workCenterCode || !responsavel || ordens.length === 0) {
          return of(null);
        }
        return forkJoin({
          centers: this.pesquisarCentros(areaCode, ''),
          reportes: this.listarReportesBatelada(start.aggregateId),
          responsaveis: this.listarResponsaveisElegiveis(areaCode, workCenterCode),
        }).pipe(map(({ centers, reportes, responsaveis }) => {
          const workCenter = centers.find(item => item.code === workCenterCode);
          if (!workCenter) return null;
          const area = { code: workCenter.areaCode, description: workCenter.area };
          const inicio: InicioBatelada = {
            batchId: start.aggregateId,
            iniciadoEm: new Date(start.occurredAt),
            ordensIniciadas: ordens.map(ordem => ordem.id),
            startCommandId: start.idempotencyKey,
            delivery: this.deliveryResult(outboxById.get(start.localId)),
          };
          return {
            area,
            workCenter,
            orders: ordens.map(ordem => ({ ...ordem })),
            selectedOrderIds: ordens.map(ordem => ordem.id),
            composition: ordens.map(ordem => ({ ...ordem })),
            responsaveis,
            tipoResponsavel: responsavel.tipo,
            responsavel: { ...responsavel },
            estado: EstadoBatelada.BateladaIniciada,
            asyncState: 'sucesso' as const,
            lastOperationalState: EstadoBatelada.BateladaIniciada,
            errorMessage: '',
            batchId: start.aggregateId,
            inicio,
            history: reportes,
            draft: null,
            reportAsyncState: 'ocioso' as const,
            historyAsyncState: 'sucesso' as const,
            endingAsyncState: 'ocioso' as const,
            encerramento: null,
          };
        }));
      }),
    );
  }

  listarAreas(): Observable<ReadonlyArray<AreaProducao>> {
    return this.productionCatalog.listarAreas().pipe(
      map(areas => areas.map(area => ({ ...area }))),
    );
  }

  pesquisarCentros(areaCode: string, termo: string): Observable<ReadonlyArray<WorkCenter>> {
    if (!areaCode.trim()) {
      return of([]);
    }

    return this.productionCatalog.pesquisarCentros(areaCode, termo).pipe(
      map(centers => centers.map(center => ({ ...center }))),
    );
  }

  listarOrdensLiberadas(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<OrdemLiberadaBatelada>> {
    if (!areaCode.trim() || !workCenterCode.trim()) {
      return of([]);
    }

    return this.reportCatalog.listarOrdensPorCentro(areaCode, workCenterCode).pipe(
      map(orders => orders.map(order => ({ ...order }))),
    );
  }

  listarResponsaveisElegiveis(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<ResponsavelBatelada>> {
    if (!areaCode.trim() || !workCenterCode.trim()) {
      return of([]);
    }

    return this.productionCatalog.listarResponsaveis(areaCode, workCenterCode).pipe(
      map(responsaveis => responsaveis.map(responsavel => ({ ...responsavel }))),
    );
  }

  adotarOrdensIniciadas(
    ordens: ReadonlyArray<OrdemLiberadaBatelada>,
  ): Observable<InicioBatelada> {
    return defer(() => {
      const uniqueOrderIds = new Set(ordens.map(ordem => ordem.id));
      if (
        ordens.length === 0
        || uniqueOrderIds.size !== ordens.length
        || ordens.some(ordem => ordem.indEstadoSplit !== 4)
      ) {
        throw new Error('A composição deve conter somente ordens já iniciadas.');
      }

      return forkJoin(ordens.map(ordem =>
        this.reportCatalog.carregarOrdemSelecionada(ordem)));
    }).pipe(map(results => {
      const starts = results.map(result => {
        const operation = result.sucesso ? result.operacao : undefined;
        if (!operation?.dataInicio || !operation.horaInicio) {
          throw new Error('Não foi possível confirmar o início de todas as ordens selecionadas.');
        }
        return this.operationStartInstant(operation.dataInicio, operation.horaInicio);
      });
      const iniciadoEm = new Date(Math.max(...starts.map(start => start.getTime())));
      const batchId = this.idempotency.resolve();
      const orderIds = ordens.map(ordem => ordem.id);
      this.batches.set(batchId, { orderIds: [...orderIds], encerrada: false });
      this.reportsByBatch.set(batchId, []);
      return {
        batchId,
        iniciadoEm,
        ordensIniciadas: [...orderIds],
        origem: 'DATASUL' as const,
      };
    }));
  }

  montarComandoInicio(
    contexto: ContextoBatelada,
    responsavel: ResponsavelBatelada,
    ordens: ReadonlyArray<OrdemLiberadaBatelada>,
  ): IniciarBateladaRequest {
    const uniqueOrderIds = new Set(ordens.map(ordem => ordem.id));
    if (ordens.length === 0 || uniqueOrderIds.size !== ordens.length) {
      throw new Error('A batelada deve conter ordens únicas.');
    }

    const now = new Date();
    return {
      batchId: this.idempotency.resolve(),
      idempotencyKey: this.idempotency.resolve(),
      occurredAt: now.toISOString(),
      dataInicio: this.formatLocalDate(now),
      horaInicio: this.formatLocalTime(now),
      contexto: { ...contexto },
      responsavel: { ...responsavel },
      ordens: ordens.map(ordem => ({ ...ordem })),
    };
  }

  iniciarBatelada(request: IniciarBateladaRequest): Observable<InicioBateladaEntregue> {
    const batchId = this.idempotency.resolve(request.batchId);
    const idempotencyKey = this.idempotency.resolve(request.idempotencyKey);
    const iniciadoEm = request.occurredAt
      ? new Date(request.occurredAt)
      : new Date();
    if (Number.isNaN(iniciadoEm.getTime())) {
      throw new Error('O instante de início da batelada é inválido.');
    }
    const orderIds = request.ordens.map(ordem => ordem.id);
    const payload = {
      batchId,
      contexto: { ...request.contexto },
      responsavel: { ...request.responsavel },
      ordens: request.ordens.map(ordem => ({ ...ordem })),
      iniciadoEm: iniciadoEm.toISOString(),
      dataInicio: request.dataInicio,
      horaInicio: request.horaInicio,
    };
    return defer(() => this.api.post<DirectBatchStartReceipt>(
      '/api/batches/start', payload, idempotencyKey,
    )).pipe(
      map(response => {
        const receipt = this.validateDirectStartReceipt(response, idempotencyKey, orderIds);
        const inicio: InicioBateladaEntregue = {
          batchId,
          iniciadoEm,
          ordensIniciadas: orderIds,
          delivery: { status: 'SYNCED', receipt },
        };
        this.batches.set(batchId, { orderIds: [...orderIds], encerrada: false });
        this.reportsByBatch.set(batchId, []);
        return this.cloneInicio(inicio) as InicioBateladaEntregue;
      }),
      catchError(error => of(this.cloneInicio({
        batchId,
        iniciadoEm,
        ordensIniciadas: orderIds,
        delivery: { status: 'ERROR', error: this.directStartError(error) },
      }) as InicioBateladaEntregue)),
    );
  }

  validarRespostaInicio(
    response: IniciarBateladaResponse,
    expectedOrderIds: ReadonlyArray<string>,
  ): InicioBatelada {
    const expected = new Set(expectedOrderIds);
    const received = new Set(response.resultados.map(result => result.ordemId));
    const complete =
      response.status === 'SUCESSO_INTEGRAL' &&
      typeof response.batchId === 'string' &&
      response.batchId.trim().length > 0 &&
      response.iniciadoEm instanceof Date &&
      !Number.isNaN(response.iniciadoEm.getTime()) &&
      expectedOrderIds.length > 0 &&
      expected.size === expectedOrderIds.length &&
      response.resultados.length === expected.size &&
      response.resultados.every(result => result.sucesso && expected.has(result.ordemId)) &&
      [...expected].every(id => received.has(id));

    if (!complete) {
      throw new Error('O início conjunto não foi confirmado para todas as ordens.');
    }

    return {
      batchId: response.batchId,
      iniciadoEm: new Date(response.iniciadoEm),
      ordensIniciadas: expectedOrderIds.map(id => id),
    };
  }

  validarReporteParcial(request: ReporteParcialBateladaRequest): void {
    if (!request.idempotencyKey.trim()) {
      throw new Error('A chave de idempotência é obrigatória.');
    }

    const quantities = request.items.flatMap(item => [
      item.quantidadeAprovada,
      item.quantidadeRetrabalho,
      item.quantidadeRefugo,
      ...item.refugoItens.map(reason => reason.quantidade),
    ]);

    if (quantities.some(quantity => !Number.isFinite(quantity) || quantity < 0)) {
      throw new Error('As quantidades devem ser números finitos e não negativos.');
    }

    const total = request.items.reduce(
      (sum, item) =>
        sum +
        item.quantidadeAprovada +
        item.quantidadeRetrabalho +
        item.quantidadeRefugo,
      0,
    );
    if (!Number.isFinite(total)) {
      throw new Error('O total informado excede o limite permitido.');
    }
    if (total <= 0) {
      throw new Error('Informe ao menos uma quantidade positiva para salvar o reporte.');
    }

    for (const item of request.items) {
      const requiresReason = arredondarQuantidadeBatelada(item.quantidadeRefugo) > 0;
      if (requiresReason && item.refugoItens.length !== 1) {
        throw new Error(`Informe um motivo de refugo para a ordem ${item.ordem}.`);
      }
      if (!requiresReason && item.refugoItens.length !== 0) {
        throw new Error(`Remova o motivo da ordem ${item.ordem}, pois não há refugo.`);
      }
      if (
        requiresReason &&
        arredondarQuantidadeBatelada(item.refugoItens[0].quantidade) !==
          arredondarQuantidadeBatelada(item.quantidadeRefugo)
      ) {
        throw new Error(
          `A quantidade do motivo deve ser igual à quantidade de refugo da ordem ${item.ordem}.`,
        );
      }
    }
  }

  reportarBateladaParcial(
    request: ReporteParcialBateladaRequest,
  ): Observable<ReporteParcialBateladaEntregue> {
    // Mock transacional da fronteira semântica. A integração Datasul futura deve
    // garantir atomicidade ou devolver resultados por ordem para reconciliação.
    const command = this.cloneReportRequest(request);
    return of(null).pipe(
      map(() => {
        this.validarReporteParcial(command);
        const isKnownReplay = (this.reportsByBatch.get(command.batchId) ?? [])
          .some(report => report.idempotencyKey === command.idempotencyKey);
        return { command, isKnownReplay };
      }),
      switchMap(({ command: validated, isKnownReplay }) =>
        from(isKnownReplay
          ? Promise.resolve()
          : this.assertActiveBatchCompositionDurable(
              validated.batchId,
              validated.items.map(item => item.orderId),
            )).pipe(map(() => validated))),
      switchMap(validated => from(this.commands.capture({
        commandType: 'REPORT_BATCH',
        aggregateId: validated.batchId,
        businessStatus: 'REPORTADA',
        idempotencyKey: validated.idempotencyKey,
        ...(validated.dependencyIds
          ? { dependencyIds: validated.dependencyIds }
          : {}),
        payload: {
          batchId: validated.batchId,
          contexto: { ...validated.contexto },
          responsavel: { ...validated.responsavel },
          dataInicio: validated.dataInicio.toISOString(),
          horaInicio: validated.horaInicio,
          dataFim: validated.dataFim.toISOString(),
          horaFim: validated.horaFim,
          finalizarSplit: validated.finalizarSplit,
          items: validated.items.map(item => ({
            ...item,
            refugoItens: item.refugoItens.map(reason => ({ ...reason })),
          })),
        },
      })).pipe(
        switchMap(confirmation => {
          this.captureReportMilestone(
            'batch_report_persisted', 'info', confirmation.idempotencyKey, 'PENDING',
            'persist',
          );
          return from(this.deliverReport(confirmation.localId)).pipe(
          map(delivery => {
            this.captureReportMilestone(
              'batch_report_delivery_observed',
              delivery.status === 'ERROR' ? 'error' : delivery.status === 'PENDING' ? 'warn' : 'info',
              confirmation.idempotencyKey,
              delivery.status,
              'delivery',
              delivery.status === 'ERROR' ? delivery.error : undefined,
            );
            const confirmed: ReporteParcialBatelada = {
              reporteId: confirmation.localId,
              batchId: validated.batchId,
              idempotencyKey: confirmation.idempotencyKey,
              confirmadoEm: new Date(confirmation.committedAt),
              items: this.cloneItems(validated.items),
            };
            if (delivery.status !== 'ERROR') {
              const stored = this.cloneReport(confirmed);
              const existing = this.reportsByBatch.get(validated.batchId) ?? [];
              this.reportsByBatch.set(validated.batchId, [
                ...existing.filter(report => report.idempotencyKey !== stored.idempotencyKey),
                stored,
              ]);
            }
            return {
              ...this.cloneReport(confirmed),
              delivery: structuredClone(delivery),
            };
          }),
          );
        }),
      )),
    );
  }

  private captureReportMilestone(
    event: 'batch_report_persisted' | 'batch_report_delivery_observed',
    level: 'info' | 'warn' | 'error',
    correlationId: string,
    toStatus: 'PENDING' | 'SYNCED' | 'ERROR',
    stage: 'persist' | 'delivery',
    error?: PersistedSyncError,
  ): void {
    try {
      this.clientLogs.capture({
        level,
        category: 'synchronization',
        event,
        correlationId,
        context: {
          commandType: 'REPORT_BATCH',
          aggregateType: 'BATCH',
          ...(stage === 'delivery' ? { fromStatus: 'PENDING' as const } : {}),
          toStatus,
          stage,
          ...(error ? { code: error.code, failureCategory: error.category } : {}),
        },
      });
    } catch {
      // O reporte não pode depender do diagnóstico.
    }
  }

  validarRespostaReporte(
    response: ReporteParcialBateladaResponse,
    request: ReporteParcialBateladaRequest,
  ): ReporteParcialBatelada {
    const expectedOrderIds = request.items.map(item => item.orderId);
    const validResults = this.hasCompleteResults(response.status, response.resultados, expectedOrderIds);
    const complete =
      validResults &&
      response.batchId === request.batchId &&
      response.idempotencyKey === request.idempotencyKey &&
      typeof response.reporteId === 'string' &&
      response.reporteId.trim().length > 0 &&
      response.confirmadoEm instanceof Date &&
      !Number.isNaN(response.confirmadoEm.getTime());

    if (!complete) {
      throw new Error('O reporte conjunto não foi confirmado para todas as ordens.');
    }

    return {
      reporteId: response.reporteId,
      batchId: response.batchId,
      idempotencyKey: response.idempotencyKey,
      confirmadoEm: new Date(response.confirmadoEm),
      items: this.cloneItems(request.items),
    };
  }

  listarReportesBatelada(batchId: string): Observable<ReadonlyArray<ReporteParcialBatelada>> {
    const ownerId = this.authSession?.currentUser?.id;
    if (ownerId) {
      return from(this.localRecords.listByOwner(ownerId)).pipe(
        map(records => records
          .filter(record =>
            record.commandType === 'REPORT_BATCH'
            && record.aggregateId === batchId)
          .flatMap(record => {
            const payload = record.payload as {
              readonly items?: ReadonlyArray<ItemReporteBatelada>;
            };
            return payload.items
              ? [{
                  reporteId: record.localId,
                  batchId,
                  idempotencyKey: record.idempotencyKey,
                  confirmadoEm: new Date(record.createdAt),
                  items: this.cloneItems(payload.items),
                }]
              : [];
          })
          .map(report => this.cloneReport(report))),
      );
    }
    return of(null).pipe(
      delay(100),
      map(() => (this.reportsByBatch.get(batchId) ?? []).map(report => this.cloneReport(report))),
    );
  }

  encerrarBatelada(request: EncerrarBateladaRequest): Observable<EncerramentoBatelada> {
    const idempotencyKey = this.idempotency.resolve(request.idempotencyKey);
    return from(this.assertActiveBatchCompositionDurable(
      request.batchId,
      request.orderIds,
    )).pipe(
      switchMap(() => from(this.commands.capture({
        commandType: 'END_BATCH',
        aggregateId: request.batchId,
        businessStatus: 'FINALIZADA',
        idempotencyKey,
        ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
        payload: {
          batchId: request.batchId,
          orderIds: [...request.orderIds],
        },
      }))),
      map(confirmation => {
        const encerramento: EncerramentoBatelada = {
          batchId: request.batchId,
          encerradoEm: new Date(confirmation.committedAt),
          ordensEncerradas: [...request.orderIds],
        };
        const batch = this.batches.get(request.batchId);
        if (batch) {
          batch.encerrada = true;
        }
        return this.cloneEnding(encerramento);
      }),
    );
  }

  validarRespostaEncerramento(
    response: EncerrarBateladaResponse,
    batchId: string,
    expectedOrderIds: ReadonlyArray<string>,
  ): EncerramentoBatelada {
    const complete =
      this.hasCompleteResults(response.status, response.resultados, expectedOrderIds) &&
      response.batchId === batchId &&
      response.encerradoEm instanceof Date &&
      !Number.isNaN(response.encerradoEm.getTime());

    if (!complete) {
      throw new Error('O encerramento conjunto não foi confirmado para todas as ordens.');
    }

    return {
      batchId,
      encerradoEm: new Date(response.encerradoEm),
      ordensEncerradas: [...expectedOrderIds],
    };
  }

  private assertActiveBatchComposition(batchId: string, orderIds: ReadonlyArray<string>): void {
    const batch = this.batches.get(batchId);
    const matches =
      batch !== undefined &&
      !batch.encerrada &&
      batch.orderIds.length === orderIds.length &&
      batch.orderIds.every((id, index) => id === orderIds[index]);
    if (!matches) {
      throw new Error('A composição da batelada não corresponde ao comando informado.');
    }
  }

  private async assertActiveBatchCompositionDurable(
    batchId: string,
    orderIds: ReadonlyArray<string>,
  ): Promise<void> {
    const batch = this.batches.get(batchId);
    if (batch) {
      this.assertActiveBatchComposition(batchId, orderIds);
      return;
    }
    const ownerId = this.authSession?.currentUser?.id;
    if (!ownerId) {
      this.assertActiveBatchComposition(batchId, orderIds);
      return;
    }
    const records = await this.localRecords.listByOwner(ownerId);
    const start = records.find(record =>
      record.commandType === 'START_BATCH' && record.aggregateId === batchId);
    const ended = records.some(record =>
      record.commandType === 'END_BATCH' && record.aggregateId === batchId);
    const payload = start?.payload as {
      readonly ordens?: ReadonlyArray<{ readonly id?: string }>;
    } | undefined;
    const durableOrderIds = payload?.ordens?.flatMap(order =>
      typeof order.id === 'string' ? [order.id] : []) ?? [];
    const matches =
      !ended
      && durableOrderIds.length === orderIds.length
      && durableOrderIds.every((id, index) => id === orderIds[index]);
    if (!matches) {
      throw new Error('A composição da batelada não corresponde ao comando informado.');
    }
    this.batches.set(batchId, { orderIds: [...durableOrderIds], encerrada: false });
  }

  private hasCompleteResults(
    status: string,
    results: ReadonlyArray<{ readonly ordemId: string; readonly sucesso: boolean }>,
    expectedOrderIds: ReadonlyArray<string>,
  ): boolean {
    const expected = new Set(expectedOrderIds);
    const received = new Set(results.map(result => result.ordemId));
    return (
      status === 'SUCESSO_INTEGRAL' &&
      expected.size === expectedOrderIds.length &&
      results.length === expectedOrderIds.length &&
      received.size === results.length &&
      results.every(result => result.sucesso && expected.has(result.ordemId)) &&
      expectedOrderIds.every(id => received.has(id))
    );
  }

  private clearSessionState(): void {
    this.stoppedWorkflow = null;
    this.batches.clear();
    this.reportsByBatch.clear();
  }

  private cloneReportRequest(
    request: ReporteParcialBateladaRequest,
  ): ReporteParcialBateladaRequest {
    return {
      batchId: request.batchId,
      idempotencyKey: request.idempotencyKey,
      contexto: { ...request.contexto },
      responsavel: { ...request.responsavel },
      dataInicio: new Date(request.dataInicio),
      horaInicio: request.horaInicio,
      dataFim: new Date(request.dataFim),
      horaFim: request.horaFim,
      finalizarSplit: request.finalizarSplit,
      ...(request.dependencyIds ? { dependencyIds: [...request.dependencyIds] } : {}),
      items: request.items.map(item => ({
        ...item,
        refugoItens: item.refugoItens.map(reason => ({ ...reason })),
      })),
    };
  }

  private cloneInicio(inicio: InicioBatelada): InicioBatelada {
    return {
      batchId: inicio.batchId,
      iniciadoEm: new Date(inicio.iniciadoEm),
      ordensIniciadas: [...inicio.ordensIniciadas],
      ...(inicio.origem ? { origem: inicio.origem } : {}),
      ...(inicio.startCommandId ? { startCommandId: inicio.startCommandId } : {}),
      ...(inicio.delivery ? { delivery: this.cloneDelivery(inicio.delivery) } : {}),
    };
  }

  private operationStartInstant(date: Date, time: string): Date {
    const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
    if (!match || !(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error('O início informado pelo Datasul é inválido.');
    }
    const result = new Date(date);
    result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (
      result.getHours() !== Number(match[1])
      || result.getMinutes() !== Number(match[2])
    ) {
      throw new Error('O início informado pelo Datasul é inválido.');
    }
    return result;
  }

  private validateDirectStartReceipt(
    response: DirectBatchStartReceipt,
    expectedIdempotencyKey: string,
    expectedOrderIds: ReadonlyArray<string>,
  ): RemoteCommandReceipt {
    const results = Array.isArray(response?.orderResults) ? response.orderResults : [];
    const expected = new Set(expectedOrderIds);
    const received = new Set(results.map(result => result.orderId));
    const complete =
      typeof response?.serverRecordId === 'string' && response.serverRecordId.trim().length > 0
      && response.idempotencyKey === expectedIdempotencyKey
      && typeof response.receivedAt === 'string'
      && !Number.isNaN(Date.parse(response.receivedAt))
      && typeof response.processedAt === 'string'
      && !Number.isNaN(Date.parse(response.processedAt))
      && typeof response.duplicate === 'boolean'
      && expected.size === expectedOrderIds.length
      && results.length === expected.size
      && results.every(result => result.success === true && expected.has(result.orderId))
      && [...expected].every(orderId => received.has(orderId));
    if (!complete) throw new InvalidDirectBatchStartReceiptError();
    return {
      serverRecordId: response.serverRecordId,
      receivedAt: response.receivedAt,
      processedAt: response.processedAt,
      duplicate: response.duplicate,
      ...(response.correlationId ? { correlationId: response.correlationId } : {}),
      orderResults: results.map(result => ({ ...result })),
    };
  }

  private directStartError(error: unknown): PersistedSyncError {
    if (error instanceof InvalidDirectBatchStartReceiptError) {
      return {
        code: 'BATCH_START_INVALID_RECEIPT',
        category: 'CONFIGURATION',
        userMessage: 'O Datasul respondeu ao início da batelada sem uma confirmação válida.',
      };
    }
    const response = error instanceof HttpErrorResponse ? error : null;
    const body = response?.error;
    const publicError = body && typeof body === 'object' && !Array.isArray(body)
      ? { status: response.status, ...(body as Readonly<Record<string, unknown>>) }
      : error;
    const normalized = normalizeCommandError(publicError);
    const publicBody = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Readonly<Record<string, unknown>>
      : null;
    const hasPublicMessage = typeof publicBody?.['userMessage'] === 'string';
    const userMessage = hasPublicMessage
      ? normalized.userMessage
      : this.directStartDefaultMessage(normalized.category);
    return {
      code: normalized.code,
      category: normalized.category,
      userMessage,
      ...(normalized.correlationId ? { correlationId: normalized.correlationId } : {}),
    };
  }

  private directStartDefaultMessage(category: PersistedSyncError['category']): string {
    switch (category) {
      case 'AUTH':
        return 'A sessão precisa ser renovada antes de iniciar a batelada.';
      case 'TRANSIENT':
        return 'Não foi possível comunicar com o Datasul. Tente iniciar a batelada novamente.';
      case 'VALIDATION':
        return 'O Datasul rejeitou os dados enviados para iniciar a batelada.';
      case 'CONFLICT':
        return 'O início da batelada conflita com o estado atual das ordens no Datasul.';
      case 'CONFIGURATION':
        return 'Não foi possível enviar o início da batelada ao Datasul.';
    }
  }

  private deliveryResult(
    entry: OutboxEntry | null | undefined,
  ): InicioBateladaEntregue['delivery'] {
    if (!entry) {
      return this.deliveryError(
        'BATCH_START_OUTBOX_MISSING',
        'CONFIGURATION',
        'Não foi possível localizar o envio do início da batelada neste dispositivo.',
      );
    }
    if (entry.status === 'SYNCED') {
      return entry.receipt
        ? { status: 'SYNCED', receipt: structuredClone(entry.receipt) }
        : this.deliveryError(
          'BATCH_START_RECEIPT_MISSING',
          'CONFIGURATION',
          'O Datasul confirmou o envio, mas o comprovante da batelada não foi encontrado.',
        );
    }
    if (entry.status === 'ERROR') {
      return entry.lastError
        ? { status: 'ERROR', error: { ...entry.lastError } }
        : this.deliveryError(
          'BATCH_START_ERROR_MISSING',
          'CONFIGURATION',
          'O início da batelada falhou sem uma mensagem operacional disponível.',
        );
    }
    if (
      entry.status === 'RETRY_WAIT'
      && entry.lastError?.category === 'TRANSIENT'
    ) {
      return { status: 'PENDING' };
    }
    if (entry.status === 'SYNCING') {
      return { status: 'PENDING' };
    }
    if (entry.status === 'BLOCKED_AUTH') {
      return entry.lastError
        ? { status: 'ERROR', error: { ...entry.lastError } }
        : this.deliveryError(
          'BATCH_START_AUTH_REQUIRED',
          'AUTH',
          'A sessão precisa ser renovada antes de iniciar a batelada.',
        );
    }
    if (entry.status === 'BLOCKED_DEPENDENCY') {
      return entry.lastError
        ? { status: 'ERROR', error: { ...entry.lastError } }
        : this.deliveryError(
          'BATCH_START_DEPENDENCY_BLOCKED',
          'CONFIGURATION',
          'O início da batelada está bloqueado por uma dependência operacional.',
        );
    }
    return this.deliveryError(
      'BATCH_START_NOT_DELIVERED',
      'CONFIGURATION',
      'Não foi possível confirmar uma tentativa de envio do início da batelada.',
    );
  }

  private cloneDelivery(delivery: InicioBateladaEntregue['delivery']): InicioBateladaEntregue['delivery'] {
    return structuredClone(delivery);
  }

  private async deliverReport(localId: string): Promise<ImmediateDeliveryResult> {
    const observed = await this.immediateDelivery.deliver(localId);
    if (observed.status !== 'PENDING') return observed;
    const ownerId = this.authSession?.currentUser?.id.trim();
    if (!ownerId) {
      return this.deliveryError(
        'BATCH_REPORT_SESSION_REQUIRED',
        'AUTH',
        'A sessão precisa ser renovada antes de enviar o reporte.',
      );
    }
    return this.reportDeliveryResult(await this.outbox.getById(ownerId, localId));
  }

  private reportDeliveryResult(entry: OutboxEntry | null | undefined): ImmediateDeliveryResult {
    if (!entry) {
      return this.deliveryError(
        'BATCH_REPORT_OUTBOX_MISSING',
        'CONFIGURATION',
        'Não foi possível localizar o envio do reporte neste dispositivo.',
      );
    }
    if (entry.status === 'SYNCED') {
      return entry.receipt
        ? { status: 'SYNCED', receipt: structuredClone(entry.receipt) }
        : this.deliveryError(
          'BATCH_REPORT_RECEIPT_MISSING',
          'CONFIGURATION',
          'O Datasul confirmou o envio, mas o comprovante do reporte não foi encontrado.',
        );
    }
    if (entry.status === 'ERROR' || entry.status === 'BLOCKED_AUTH'
      || entry.status === 'BLOCKED_DEPENDENCY') {
      return entry.lastError
        ? { status: 'ERROR', error: { ...entry.lastError } }
        : this.deliveryError(
          'BATCH_REPORT_ERROR_MISSING',
          'CONFIGURATION',
          'O reporte falhou sem uma mensagem operacional disponível.',
        );
    }
    if (
      entry.status === 'SYNCING'
      || (entry.status === 'RETRY_WAIT' && entry.lastError?.category === 'TRANSIENT')
    ) {
      return { status: 'PENDING' };
    }
    return this.deliveryError(
      'BATCH_REPORT_NOT_DELIVERED',
      'CONFIGURATION',
      'Não foi possível confirmar uma falha de conexão ao enviar o reporte.',
    );
  }

  private isRestorableStart(entry: OutboxEntry | undefined): boolean {
    if (!entry || deliveryDispositionOf(entry.deliveryDisposition) !== 'ACTIVE') return false;
    if (entry.status === 'SYNCED') return Boolean(entry.receipt);
    return entry.status === 'SYNCING'
      || (entry.status === 'RETRY_WAIT' && entry.lastError?.category === 'TRANSIENT');
  }

  private deliveryError(
    code: string,
    category: 'AUTH' | 'CONFIGURATION',
    userMessage: string,
  ): ImmediateDeliveryResult {
    return { status: 'ERROR', error: { code, category, userMessage } };
  }

  private cloneItems(
    items: ReadonlyArray<ItemReporteBatelada>,
  ): ReadonlyArray<ItemReporteBatelada> {
    return items.map(item => ({
      ...item,
      refugoItens: item.refugoItens.map(reason => ({ ...reason })),
    }));
  }

  private cloneReport(report: ReporteParcialBatelada): ReporteParcialBatelada {
    return {
      ...report,
      confirmadoEm: new Date(report.confirmadoEm),
      items: this.cloneItems(report.items),
    };
  }

  private cloneEnding(encerramento: EncerramentoBatelada): EncerramentoBatelada {
    return {
      ...encerramento,
      encerradoEm: new Date(encerramento.encerradoEm),
      ordensEncerradas: [...encerramento.ordensEncerradas],
    };
  }

  private formatQuantity(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value);
  }

  private formatLocalDate(value: Date): string {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private formatLocalTime(value: Date): string {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
}
