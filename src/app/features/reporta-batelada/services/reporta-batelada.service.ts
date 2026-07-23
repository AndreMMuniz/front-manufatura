import { Injectable, inject } from '@angular/core';

import { Observable, delay, map, of } from 'rxjs';

import { ReportOperacaoService } from '../../report-operacao/services/report-operacao.service';
import { WorkCenter } from '../../shop-floor/models/work-center';
import {
  EncerrarBateladaRequest,
  EncerrarBateladaResponse,
  IniciarBateladaRequest,
  IniciarBateladaResponse,
  ReporteParcialBateladaRequest,
  ReporteParcialBateladaResponse,
} from '../interfaces/reporta-batelada.dto';
import {
  AreaProducaoBatelada,
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

interface IdempotentReportRecord {
  readonly fingerprint: string;
  readonly report: ReporteParcialBatelada;
}

@Injectable({ providedIn: 'root' })
export class ReportaBateladaService {
  private readonly catalog = inject(ReportOperacaoService);
  private readonly batches = new Map<string, BatchMockRecord>();
  private readonly reportsByBatch = new Map<string, ReadonlyArray<ReporteParcialBatelada>>();
  private readonly reportsByIdempotency = new Map<string, IdempotentReportRecord>();
  private stoppedWorkflow: ReportaBateladaWorkflowSnapshot | null = null;
  private batchSequence = 0;
  private reportSequence = 0;

  preservarFluxoParada(snapshot: ReportaBateladaWorkflowSnapshot): void {
    this.stoppedWorkflow = snapshot;
  }

  retomarFluxoParada(): ReportaBateladaWorkflowSnapshot | null {
    const snapshot = this.stoppedWorkflow;
    this.stoppedWorkflow = null;
    return snapshot;
  }

  listarAreas(): Observable<ReadonlyArray<AreaProducaoBatelada>> {
    return this.catalog.listarAreasProducao().pipe(
      map(areas => areas.map(area => ({ code: area.code, description: area.description }))),
    );
  }

  pesquisarCentros(areaCode: string, termo: string): Observable<ReadonlyArray<WorkCenter>> {
    if (!areaCode.trim()) {
      return of([]);
    }

    return this.catalog.pesquisarCentrosTrabalho(areaCode, termo).pipe(
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

    return this.catalog.listarOrdensPorCentro(areaCode, workCenterCode).pipe(
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

    return this.catalog.listarResponsaveis(areaCode, workCenterCode).pipe(
      map(responsaveis => responsaveis.map(responsavel => ({ ...responsavel }))),
    );
  }

  montarComandoInicio(
    contexto: ContextoBatelada,
    responsavel: ResponsavelBatelada,
    ordens: ReadonlyArray<OrdemLiberadaBatelada>,
  ): IniciarBateladaRequest {
    return {
      contexto: { ...contexto },
      responsavel: { ...responsavel },
      ordens: ordens.map(ordem => ({ ...ordem })),
    };
  }

  iniciarBatelada(request: IniciarBateladaRequest): Observable<InicioBatelada> {
    const batchId = `batch-${++this.batchSequence}`;
    const response: IniciarBateladaResponse = {
      status: 'SUCESSO_INTEGRAL',
      batchId,
      iniciadoEm: new Date(),
      resultados: request.ordens.map(ordem => ({ ordemId: ordem.id, sucesso: true })),
    };

    return of(response).pipe(
      delay(200),
      map(result => {
        const inicio = this.validarRespostaInicio(result, request.ordens.map(ordem => ordem.id));
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
      delay(200),
      map(() => {
        this.validarReporteParcial(command);
        this.assertActiveBatchComposition(
          command.batchId,
          command.items.map(item => item.orderId),
        );

        const idempotencyIdentity = `${command.batchId}:${command.idempotencyKey}`;
        const fingerprint = this.reportFingerprint(command);
        const prior = this.reportsByIdempotency.get(idempotencyIdentity);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            throw new Error('A chave de idempotência já foi usada com outro conteúdo.');
          }
          return this.cloneReport(prior.report);
        }

        const response: ReporteParcialBateladaResponse = {
          status: 'SUCESSO_INTEGRAL',
          reporteId: `report-${++this.reportSequence}`,
          batchId: command.batchId,
          idempotencyKey: command.idempotencyKey,
          confirmadoEm: new Date(),
          resultados: command.items.map(item => ({ ordemId: item.orderId, sucesso: true })),
        };
        const confirmed = this.validarRespostaReporte(response, command);
        const stored = this.cloneReport(confirmed);
        this.reportsByIdempotency.set(idempotencyIdentity, { fingerprint, report: stored });
        this.reportsByBatch.set(command.batchId, [
          ...(this.reportsByBatch.get(command.batchId) ?? []),
          stored,
        ]);
        return this.cloneReport(stored);
      }),
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
      response.confirmadoEm instanceof Date;

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
    return of(null).pipe(
      delay(200),
      map(() => {
        this.assertActiveBatchComposition(request.batchId, request.orderIds);
        const response: EncerrarBateladaResponse = {
          status: 'SUCESSO_INTEGRAL',
          batchId: request.batchId,
          encerradoEm: new Date(),
          resultados: request.orderIds.map(ordemId => ({ ordemId, sucesso: true })),
        };
        const encerramento = this.validarRespostaEncerramento(
          response,
          request.batchId,
          request.orderIds,
        );
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
      response.encerradoEm instanceof Date;

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

  private reportFingerprint(request: ReporteParcialBateladaRequest): string {
    return JSON.stringify({
      batchId: request.batchId,
      items: request.items.map(item => ({
        ...item,
        refugoItens: item.refugoItens.map(reason => ({ ...reason })),
      })),
    });
  }

  private cloneReportRequest(
    request: ReporteParcialBateladaRequest,
  ): ReporteParcialBateladaRequest {
    return {
      batchId: request.batchId,
      idempotencyKey: request.idempotencyKey,
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
