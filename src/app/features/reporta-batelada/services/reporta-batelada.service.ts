import { Injectable, inject } from '@angular/core';

import { Observable, delay, from, map, of, switchMap } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { IdempotencyService } from '../../../core/offline/services/idempotency.service';
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
  ItemReporteBatelada,
  OrdemLiberadaBatelada,
  ReporteParcialBatelada,
  ResponsavelBatelada,
} from '../models/reporta-batelada.model';
import type { ReportaBateladaWorkflowSnapshot } from './reporta-batelada-workflow-state';

interface BatchMockRecord {
  readonly orderIds: ReadonlyArray<string>;
  encerrada: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReportaBateladaService {
  private readonly reportCatalog = inject(ReportOperacaoService);
  private readonly productionCatalog = inject(ProductionContextCatalogService);
  private readonly authSession = inject(AuthSessionService, { optional: true });
  private readonly idempotency = inject(IdempotencyService);
  private readonly commands = inject(OperationalCommandFacade);
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

  montarComandoInicio(
    contexto: ContextoBatelada,
    responsavel: ResponsavelBatelada,
    ordens: ReadonlyArray<OrdemLiberadaBatelada>,
  ): IniciarBateladaRequest {
    const uniqueOrderIds = new Set(ordens.map(ordem => ordem.id));
    if (ordens.length === 0 || uniqueOrderIds.size !== ordens.length) {
      throw new Error('A batelada deve conter ordens únicas.');
    }

    return {
      batchId: this.idempotency.resolve(),
      idempotencyKey: this.idempotency.resolve(),
      contexto: { ...contexto },
      responsavel: { ...responsavel },
      ordens: ordens.map(ordem => ({ ...ordem })),
    };
  }

  iniciarBatelada(request: IniciarBateladaRequest): Observable<InicioBatelada> {
    const batchId = this.idempotency.resolve(request.batchId);
    const idempotencyKey = this.idempotency.resolve(request.idempotencyKey);
    const iniciadoEm = new Date();
    return from(this.commands.capture({
      commandType: 'START_BATCH',
      aggregateId: batchId,
      businessStatus: 'INICIADA',
      idempotencyKey,
      occurredAt: iniciadoEm.toISOString(),
      payload: {
        batchId,
        contexto: { ...request.contexto },
        responsavel: { ...request.responsavel },
        ordens: request.ordens.map(ordem => ({ ...ordem })),
        iniciadoEm: iniciadoEm.toISOString(),
      },
    })).pipe(
      map(confirmation => {
        const inicio: InicioBatelada = {
          batchId,
          iniciadoEm,
          ordensIniciadas: request.ordens.map(ordem => ordem.id),
          startCommandId: confirmation.idempotencyKey,
        };
        this.batches.set(inicio.batchId, {
          orderIds: [...inicio.ordensIniciadas],
          encerrada: false,
        });
        this.reportsByBatch.set(inicio.batchId, []);
        return this.cloneInicio(inicio);
      }),
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
      const reasonTotal = arredondarQuantidadeBatelada(
        item.refugoItens.reduce((sum, reason) => sum + reason.quantidade, 0),
      );
      if (reasonTotal !== arredondarQuantidadeBatelada(item.quantidadeRefugo)) {
        throw new Error(
          `Os motivos de refugo da ordem ${item.ordem} devem totalizar ` +
          `${this.formatQuantity(item.quantidadeRefugo)}.`,
        );
      }
    }
  }

  reportarBateladaParcial(
    request: ReporteParcialBateladaRequest,
  ): Observable<ReporteParcialBatelada> {
    // Mock transacional da fronteira semântica. A integração Datasul futura deve
    // garantir atomicidade ou devolver resultados por ordem para reconciliação.
    const command = this.cloneReportRequest(request);
    return of(null).pipe(
      map(() => {
        this.validarReporteParcial(command);
        this.assertActiveBatchComposition(
          command.batchId,
          command.items.map(item => item.orderId),
        );

        return command;
      }),
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
          items: validated.items.map(item => ({
            ...item,
            refugoItens: item.refugoItens.map(reason => ({ ...reason })),
          })),
        },
      })).pipe(map(confirmation => {
        const confirmed: ReporteParcialBatelada = {
          reporteId: confirmation.localId,
          batchId: validated.batchId,
          idempotencyKey: confirmation.idempotencyKey,
          confirmadoEm: new Date(confirmation.committedAt),
          items: this.cloneItems(validated.items),
        };
        const stored = this.cloneReport(confirmed);
        const existing = this.reportsByBatch.get(validated.batchId) ?? [];
        this.reportsByBatch.set(validated.batchId, [
          ...existing.filter(report => report.idempotencyKey !== stored.idempotencyKey),
          stored,
        ]);
        return this.cloneReport(stored);
      }))),
    );
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
    return of(null).pipe(
      delay(100),
      map(() => (this.reportsByBatch.get(batchId) ?? []).map(report => this.cloneReport(report))),
    );
  }

  encerrarBatelada(request: EncerrarBateladaRequest): Observable<EncerramentoBatelada> {
    this.assertActiveBatchComposition(request.batchId, request.orderIds);
    const idempotencyKey = this.idempotency.resolve(request.idempotencyKey);
    return from(this.commands.capture({
      commandType: 'END_BATCH',
      aggregateId: request.batchId,
      businessStatus: 'FINALIZADA',
      idempotencyKey,
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      payload: {
        batchId: request.batchId,
        orderIds: [...request.orderIds],
      },
    })).pipe(
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
      ...(inicio.startCommandId ? { startCommandId: inicio.startCommandId } : {}),
    };
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
}
