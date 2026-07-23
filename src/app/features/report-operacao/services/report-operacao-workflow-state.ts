import { Injectable, Optional, signal } from '@angular/core';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { WorkCenter } from '../../shop-floor/models/work-center';
import {
  AreaProducao,
  EstadoOperacao,
  OrdemCentroTrabalho,
  ReportOperacao,
  ReporteParcialOperacao,
  ResponsavelOperacao,
} from '../models/report-operacao.model';

export interface WorkflowScrapItem {
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
}

export interface ReportOperacaoWorkflowSnapshot {
  readonly area: AreaProducao | null;
  readonly workCenter: WorkCenter | null;
  readonly orders: ReadonlyArray<OrdemCentroTrabalho>;
  readonly selectedOrderIds: ReadonlySet<string>;
  readonly queue: ReadonlyArray<OrdemCentroTrabalho>;
  readonly activeOrder: OrdemCentroTrabalho | null;
  readonly operation: ReportOperacao | null;
  readonly operationState: EstadoOperacao;
  readonly scrapItems: ReadonlyArray<WorkflowScrapItem>;
  readonly lastScrapReason: string;
  readonly responsavel: ResponsavelOperacao | null;
  readonly reportes: ReadonlyArray<ReporteParcialOperacao>;
}

@Injectable({ providedIn: 'root' })
export class ReportOperacaoWorkflowState {
  private readonly value = signal<ReportOperacaoWorkflowSnapshot>(this.emptySnapshot());

  constructor(@Optional() authSession?: AuthSessionService) {
    authSession?.session$.subscribe(session => {
      if (session === null) {
        this.clear();
      }
    });
  }

  snapshot(): ReportOperacaoWorkflowSnapshot {
    return this.cloneSnapshot(this.value());
  }

  setContext(area: AreaProducao | null, workCenter: WorkCenter | null): void {
    const current = this.value();
    const sameArea = current.area?.code === area?.code;
    const sameCenter = current.workCenter?.code === workCenter?.code;

    if (sameArea && sameCenter) {
      this.value.update(snapshot => ({
        ...snapshot,
        area: area ? { ...area } : null,
        workCenter: workCenter ? { ...workCenter } : null,
      }));
      return;
    }

    this.value.set({
      ...this.emptySnapshot(),
      area: area ? { ...area } : null,
      workCenter: workCenter ? { ...workCenter } : null,
    });
  }

  setOrders(orders: ReadonlyArray<OrdemCentroTrabalho>): void {
    const validIds = new Set(orders.map(order => order.id));
    this.value.update(current => ({
      ...current,
      orders: this.cloneOrders(orders),
      selectedOrderIds: new Set([...current.selectedOrderIds].filter(id => validIds.has(id))),
    }));
  }

  setSelectedOrderIds(ids: ReadonlySet<string>): void {
    const availableIds = new Set(this.value().orders.map(order => order.id));
    this.value.update(current => ({
      ...current,
      selectedOrderIds: new Set([...ids].filter(id => availableIds.has(id))),
    }));
  }

  startQueue(): OrdemCentroTrabalho | null {
    const current = this.value();
    const queue = current.orders.filter(order => current.selectedOrderIds.has(order.id));
    const activeOrder = queue[0] ?? null;
    this.value.set({
      ...current,
      queue: this.cloneOrders(queue),
      activeOrder: activeOrder ? { ...activeOrder } : null,
      operation: null,
      operationState: EstadoOperacao.SemOP,
      scrapItems: [],
      lastScrapReason: '',
      responsavel: null,
      reportes: [],
    });
    return activeOrder ? { ...activeOrder } : null;
  }

  setActiveOperation(operation: ReportOperacao, state: EstadoOperacao): void {
    this.value.update(current => ({
      ...current,
      operation: this.cloneOperation(operation),
      operationState: state,
    }));
  }

  updateOperation(operation: ReportOperacao): void {
    this.value.update(current => ({ ...current, operation: this.cloneOperation(operation) }));
  }

  setOperationState(state: EstadoOperacao): void {
    this.value.update(current => ({ ...current, operationState: state }));
  }

  setScrap(items: ReadonlyArray<WorkflowScrapItem>, lastReason: string): void {
    this.value.update(current => ({
      ...current,
      scrapItems: items.map(item => ({ ...item })),
      lastScrapReason: lastReason,
    }));
  }

  setResponsavel(responsavel: ResponsavelOperacao | null): void {
    this.value.update(current => ({
      ...current,
      responsavel: responsavel ? { ...responsavel } : null,
    }));
  }

  addReporte(reporte: ReporteParcialOperacao): void {
    this.value.update(current => ({
      ...current,
      reportes: [...current.reportes, this.cloneReporte(reporte)],
    }));
  }

  completeActiveOrder(): OrdemCentroTrabalho | null {
    const current = this.value();
    const queue = current.activeOrder
      ? current.queue.filter(order => order.id !== current.activeOrder?.id)
      : [...current.queue];
    const activeOrder = queue[0] ?? null;

    this.value.set({
      ...current,
      selectedOrderIds: new Set([...current.selectedOrderIds].filter(id => id !== current.activeOrder?.id)),
      queue: this.cloneOrders(queue),
      activeOrder: activeOrder ? { ...activeOrder } : null,
      operation: null,
      operationState: EstadoOperacao.SemOP,
      scrapItems: [],
      lastScrapReason: '',
      responsavel: null,
      reportes: [],
    });

    return activeOrder ? { ...activeOrder } : null;
  }

  finishQueue(): void {
    this.value.update(current => ({
      ...current,
      selectedOrderIds: new Set<string>(),
      queue: [],
      activeOrder: null,
      operation: null,
      operationState: EstadoOperacao.SemOP,
      scrapItems: [],
      lastScrapReason: '',
      responsavel: null,
      reportes: [],
    }));
  }

  hasActiveWorkflow(): boolean {
    return this.value().activeOrder !== null;
  }

  restore(snapshot: ReportOperacaoWorkflowSnapshot): void {
    this.value.set(this.cloneSnapshot(snapshot));
  }

  clear(): void {
    this.value.set(this.emptySnapshot());
  }

  private emptySnapshot(): ReportOperacaoWorkflowSnapshot {
    return {
      area: null,
      workCenter: null,
      orders: [],
      selectedOrderIds: new Set<string>(),
      queue: [],
      activeOrder: null,
      operation: null,
      operationState: EstadoOperacao.SemOP,
      scrapItems: [],
      lastScrapReason: '',
      responsavel: null,
      reportes: [],
    };
  }

  private cloneSnapshot(snapshot: ReportOperacaoWorkflowSnapshot): ReportOperacaoWorkflowSnapshot {
    return {
      area: snapshot.area ? { ...snapshot.area } : null,
      workCenter: snapshot.workCenter ? { ...snapshot.workCenter } : null,
      orders: this.cloneOrders(snapshot.orders),
      selectedOrderIds: new Set(snapshot.selectedOrderIds),
      queue: this.cloneOrders(snapshot.queue),
      activeOrder: snapshot.activeOrder ? { ...snapshot.activeOrder } : null,
      operation: snapshot.operation ? this.cloneOperation(snapshot.operation) : null,
      operationState: snapshot.operationState,
      scrapItems: snapshot.scrapItems.map(item => ({ ...item })),
      lastScrapReason: snapshot.lastScrapReason,
      responsavel: snapshot.responsavel ? { ...snapshot.responsavel } : null,
      reportes: snapshot.reportes.map(reporte => this.cloneReporte(reporte)),
    };
  }

  private cloneOrders(orders: ReadonlyArray<OrdemCentroTrabalho>): ReadonlyArray<OrdemCentroTrabalho> {
    return orders.map(order => ({ ...order }));
  }

  private cloneOperation(operation: ReportOperacao): ReportOperacao {
    return {
      ...operation,
      dataInicio: operation.dataInicio ? new Date(operation.dataInicio) : undefined,
      dataFim: operation.dataFim ? new Date(operation.dataFim) : undefined,
    };
  }

  private cloneReporte(reporte: ReporteParcialOperacao): ReporteParcialOperacao {
    return {
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
    };
  }
}
