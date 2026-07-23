import { Injectable, Optional, signal } from '@angular/core';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { WorkCenter } from '../../shop-floor/models/work-center';
import {
  AreaProducaoBatelada,
  arredondarQuantidadeBatelada,
  EncerramentoBatelada,
  EstadoAssincronoBatelada,
  EstadoBatelada,
  InicioBatelada,
  OrdemLiberadaBatelada,
  RascunhoReporteBatelada,
  ReporteParcialBatelada,
  ResponsavelBatelada,
  TotaisBatelada,
  TotaisOrdemBatelada,
} from '../models/reporta-batelada.model';

export interface ReportaBateladaWorkflowSnapshot {
  readonly area: AreaProducaoBatelada | null;
  readonly workCenter: WorkCenter | null;
  readonly orders: ReadonlyArray<OrdemLiberadaBatelada>;
  readonly selectedOrderIds: ReadonlyArray<string>;
  readonly composition: ReadonlyArray<OrdemLiberadaBatelada>;
  readonly responsaveis: ReadonlyArray<ResponsavelBatelada>;
  readonly responsavel: ResponsavelBatelada | null;
  readonly estado: EstadoBatelada;
  readonly asyncState: EstadoAssincronoBatelada;
  readonly lastOperationalState: EstadoBatelada;
  readonly errorMessage: string;
  readonly batchId: string | null;
  readonly inicio: InicioBatelada | null;
  readonly history: ReadonlyArray<ReporteParcialBatelada>;
  readonly draft: RascunhoReporteBatelada | null;
  readonly reportAsyncState: EstadoAssincronoBatelada;
  readonly historyAsyncState: EstadoAssincronoBatelada;
  readonly endingAsyncState: EstadoAssincronoBatelada;
  readonly encerramento: EncerramentoBatelada | null;
}

@Injectable()
export class ReportaBateladaWorkflowState {
  private readonly value = signal<ReportaBateladaWorkflowSnapshot>(this.emptySnapshot());

  constructor(@Optional() authSession?: AuthSessionService) {
    authSession?.session$.subscribe(session => {
      if (session === null) {
        this.clear();
      }
    });
  }

  snapshot(): ReportaBateladaWorkflowSnapshot {
    return this.cloneSnapshot(this.value());
  }

  setArea(area: AreaProducaoBatelada | null): boolean {
    if (this.isLocked()) {
      return false;
    }

    const current = this.value();
    if (current.area?.code === area?.code) {
      this.value.update(snapshot => ({ ...snapshot, area: area ? { ...area } : null }));
      return true;
    }

    this.value.set({
      ...this.emptySnapshot(),
      area: area ? { ...area } : null,
    });
    return true;
  }

  setWorkCenter(workCenter: WorkCenter | null): boolean {
    if (this.isLocked()) {
      return false;
    }

    const current = this.value();
    if (current.workCenter?.code === workCenter?.code) {
      this.value.update(snapshot => ({
        ...snapshot,
        workCenter: workCenter ? { ...workCenter } : null,
      }));
      return true;
    }

    this.value.set({
      ...this.emptySnapshot(),
      area: current.area ? { ...current.area } : null,
      workCenter: workCenter ? { ...workCenter } : null,
    });
    return true;
  }

  startOrdersQuery(): boolean {
    const current = this.value();
    if (this.isLocked() || !current.area || !current.workCenter) {
      return false;
    }

    this.value.update(snapshot => ({
      ...snapshot,
      orders: [],
      selectedOrderIds: [],
      composition: [],
      responsaveis: [],
      responsavel: null,
      estado: EstadoBatelada.ConsultandoOrdens,
      asyncState: 'carregando',
      errorMessage: '',
      inicio: null,
    }));
    return true;
  }

  setOrders(orders: ReadonlyArray<OrdemLiberadaBatelada>): void {
    if (this.isLocked()) {
      return;
    }

    this.value.update(current => ({
      ...current,
      orders: this.cloneOrders(orders),
      selectedOrderIds: [],
      composition: [],
      estado: EstadoBatelada.OrdensDisponiveis,
      asyncState: orders.length > 0 ? 'sucesso' : 'vazio',
      lastOperationalState: EstadoBatelada.OrdensDisponiveis,
      errorMessage: '',
      inicio: null,
    }));
  }

  failOrdersQuery(message: string): void {
    if (this.isLocked()) {
      return;
    }

    this.value.update(current => ({
      ...current,
      estado: current.area && current.workCenter
        ? EstadoBatelada.OrdensDisponiveis
        : EstadoBatelada.ContextoPendente,
      asyncState: 'erro',
      errorMessage: message,
    }));
  }

  setSelectedOrderIds(ids: ReadonlySet<string>): boolean {
    if (this.isLocked()) {
      return false;
    }

    const current = this.value();
    const availableIds = new Set(current.orders.map(order => order.id));
    const retained = current.selectedOrderIds.filter(id => ids.has(id) && availableIds.has(id));
    const added = current.orders
      .map(order => order.id)
      .filter(id => ids.has(id) && !retained.includes(id));

    this.value.update(snapshot => ({
      ...snapshot,
      selectedOrderIds: [...retained, ...added],
      composition: [],
      estado: EstadoBatelada.OrdensDisponiveis,
      lastOperationalState: EstadoBatelada.OrdensDisponiveis,
      errorMessage: '',
    }));
    return true;
  }

  selectOrder(id: string, selected: boolean): boolean {
    if (this.isLocked()) {
      return false;
    }

    const current = this.value();
    if (!current.orders.some(order => order.id === id)) {
      return false;
    }

    const ids = current.selectedOrderIds.filter(selectedId => selectedId !== id);
    if (selected) {
      ids.push(id);
    }

    this.value.update(snapshot => ({
      ...snapshot,
      selectedOrderIds: ids,
      composition: [],
      estado: EstadoBatelada.OrdensDisponiveis,
      lastOperationalState: EstadoBatelada.OrdensDisponiveis,
      errorMessage: '',
    }));
    return true;
  }

  prepareBatch(): boolean {
    if (this.isLocked()) {
      return false;
    }

    const current = this.value();
    const byId = new Map(current.orders.map(order => [order.id, order]));
    const composition = current.selectedOrderIds
      .map(id => byId.get(id))
      .filter((order): order is OrdemLiberadaBatelada => order !== undefined);

    if (composition.length === 0) {
      return false;
    }

    this.value.update(snapshot => ({
      ...snapshot,
      composition: this.cloneOrders(composition),
      estado: EstadoBatelada.BateladaPreparada,
      lastOperationalState: EstadoBatelada.BateladaPreparada,
      errorMessage: '',
    }));
    return true;
  }

  setResponsaveis(responsaveis: ReadonlyArray<ResponsavelBatelada>, preferredOperatorCode = ''): void {
    if (this.isLocked()) {
      return;
    }

    const cloned = responsaveis.map(responsavel => ({ ...responsavel }));
    const current = this.value().responsavel;
    const selected =
      cloned.find(item => current?.tipo === item.tipo && current.codigo === item.codigo) ??
      cloned.find(item => item.tipo === 'OPERADOR' && item.codigo === preferredOperatorCode) ??
      null;

    this.value.update(snapshot => ({
      ...snapshot,
      responsaveis: cloned,
      responsavel: selected ? { ...selected } : null,
    }));
  }

  setResponsavel(responsavel: ResponsavelBatelada | null): boolean {
    if (this.isLocked()) {
      return false;
    }

    const eligible = responsavel
      ? this.value().responsaveis.find(item =>
          item.tipo === responsavel.tipo && item.codigo === responsavel.codigo)
      : null;

    this.value.update(snapshot => ({
      ...snapshot,
      responsavel: eligible ? { ...eligible } : null,
      errorMessage: '',
    }));
    return responsavel === null || eligible !== undefined;
  }

  canStart(): boolean {
    const current = this.value();
    return (
      current.estado === EstadoBatelada.BateladaPreparada &&
      current.composition.length > 0 &&
      current.responsavel !== null
    );
  }

  beginStart(): boolean {
    if (!this.canStart()) {
      return false;
    }

    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.Iniciando,
      asyncState: 'carregando',
      lastOperationalState: EstadoBatelada.BateladaPreparada,
      errorMessage: '',
    }));
    return true;
  }

  completeStart(inicio: InicioBatelada): void {
    if (this.value().estado !== EstadoBatelada.Iniciando) {
      return;
    }

    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.BateladaIniciada,
      asyncState: 'sucesso',
      lastOperationalState: EstadoBatelada.BateladaIniciada,
      errorMessage: '',
      batchId: inicio.batchId,
      inicio: {
        batchId: inicio.batchId,
        iniciadoEm: new Date(inicio.iniciadoEm),
        ordensIniciadas: [...inicio.ordensIniciadas],
      },
    }));
  }

  failStart(message: string): void {
    if (this.value().estado !== EstadoBatelada.Iniciando) {
      return;
    }

    this.value.update(snapshot => ({
      ...snapshot,
      estado: snapshot.lastOperationalState,
      asyncState: 'erro',
      errorMessage: message,
      inicio: null,
    }));
  }

  canReport(): boolean {
    return this.value().estado === EstadoBatelada.BateladaIniciada;
  }

  canEnd(): boolean {
    return this.value().estado === EstadoBatelada.BateladaIniciada;
  }

  setDraft(draft: RascunhoReporteBatelada): boolean {
    const current = this.value();
    if (current.estado !== EstadoBatelada.BateladaIniciada) {
      return false;
    }

    const changed =
      current.draft !== null &&
      this.draftFingerprint(current.draft) !== this.draftFingerprint(draft);
    this.value.update(snapshot => ({
      ...snapshot,
      draft: this.cloneDraft({
        ...draft,
        idempotencyKey: changed ? null : draft.idempotencyKey,
      }),
      errorMessage: '',
    }));
    return true;
  }

  hasUnsavedDraft(): boolean {
    const draft = this.value().draft;
    return draft !== null && draft.items.some(item =>
      item.quantidadeAprovada !== 0 ||
      item.quantidadeRetrabalho !== 0 ||
      item.quantidadeRefugo !== 0 ||
      item.refugoItens.length > 0);
  }

  beginReport(): boolean {
    if (!this.canReport() || !this.value().draft) {
      return false;
    }

    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.ReportandoParcial,
      lastOperationalState: EstadoBatelada.BateladaIniciada,
      reportAsyncState: 'carregando',
      errorMessage: '',
    }));
    return true;
  }

  completeReport(report: ReporteParcialBatelada): void {
    const current = this.value();
    if (current.estado !== EstadoBatelada.ReportandoParcial || report.batchId !== current.batchId) {
      return;
    }

    const history = this.dedupeReports([...current.history, report]);
    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.BateladaIniciada,
      lastOperationalState: EstadoBatelada.BateladaIniciada,
      reportAsyncState: 'sucesso',
      historyAsyncState: 'sucesso',
      errorMessage: '',
      history,
      draft: this.emptyDraft(snapshot.composition),
    }));
  }

  failReport(message: string): void {
    if (this.value().estado !== EstadoBatelada.ReportandoParcial) {
      return;
    }

    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.BateladaIniciada,
      lastOperationalState: EstadoBatelada.BateladaIniciada,
      reportAsyncState: 'erro',
      errorMessage: message,
    }));
  }

  beginHistoryLoad(): boolean {
    if (!this.value().batchId) {
      return false;
    }
    this.value.update(snapshot => ({
      ...snapshot,
      historyAsyncState: 'carregando',
    }));
    return true;
  }

  setHistory(history: ReadonlyArray<ReporteParcialBatelada>): void {
    const batchId = this.value().batchId;
    if (!batchId) {
      return;
    }
    const valid = history.filter(report => report.batchId === batchId);
    this.value.update(snapshot => ({
      ...snapshot,
      history: this.dedupeReports(valid),
      historyAsyncState: valid.length > 0 ? 'sucesso' : 'vazio',
    }));
  }

  failHistoryLoad(message: string): void {
    this.value.update(snapshot => ({
      ...snapshot,
      historyAsyncState: 'erro',
      errorMessage: message,
    }));
  }

  totalsByOrder(): ReadonlyArray<TotaisOrdemBatelada> {
    const current = this.value();
    return current.composition.map(order => {
      const items = current.history.flatMap(report =>
        report.items.filter(item => item.orderId === order.id));
      const quantidadeAprovada = arredondarQuantidadeBatelada(
        items.reduce((sum, item) => sum + item.quantidadeAprovada, 0),
      );
      const quantidadeRetrabalho = arredondarQuantidadeBatelada(
        items.reduce((sum, item) => sum + item.quantidadeRetrabalho, 0),
      );
      const quantidadeRefugo = arredondarQuantidadeBatelada(
        items.reduce((sum, item) => sum + item.quantidadeRefugo, 0),
      );
      return {
        orderId: order.id,
        ordem: order.ordem,
        quantidadeAprovada,
        quantidadeRetrabalho,
        quantidadeRefugo,
        quantidadeTotal: arredondarQuantidadeBatelada(
          quantidadeAprovada + quantidadeRetrabalho + quantidadeRefugo,
        ),
      };
    });
  }

  batchTotals(): TotaisBatelada {
    const totals = this.totalsByOrder();
    const quantidadeAprovada = arredondarQuantidadeBatelada(
      totals.reduce((sum, item) => sum + item.quantidadeAprovada, 0),
    );
    const quantidadeRetrabalho = arredondarQuantidadeBatelada(
      totals.reduce((sum, item) => sum + item.quantidadeRetrabalho, 0),
    );
    const quantidadeRefugo = arredondarQuantidadeBatelada(
      totals.reduce((sum, item) => sum + item.quantidadeRefugo, 0),
    );
    return {
      quantidadeAprovada,
      quantidadeRetrabalho,
      quantidadeRefugo,
      quantidadeTotal: arredondarQuantidadeBatelada(
        quantidadeAprovada + quantidadeRetrabalho + quantidadeRefugo,
      ),
    };
  }

  enterStop(): boolean {
    if (this.value().estado !== EstadoBatelada.BateladaIniciada) {
      return false;
    }
    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.EmParada,
      lastOperationalState: EstadoBatelada.BateladaIniciada,
    }));
    return true;
  }

  returnFromStop(): boolean {
    if (this.value().estado !== EstadoBatelada.EmParada) {
      return false;
    }
    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.BateladaIniciada,
      lastOperationalState: EstadoBatelada.BateladaIniciada,
    }));
    return true;
  }

  beginEnding(): boolean {
    if (!this.canEnd()) {
      return false;
    }
    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.Encerrando,
      lastOperationalState: EstadoBatelada.BateladaIniciada,
      endingAsyncState: 'carregando',
      errorMessage: '',
    }));
    return true;
  }

  completeEnding(encerramento: EncerramentoBatelada): void {
    const current = this.value();
    if (
      current.estado !== EstadoBatelada.Encerrando ||
      encerramento.batchId !== current.batchId
    ) {
      return;
    }
    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.Encerrada,
      endingAsyncState: 'sucesso',
      errorMessage: '',
      encerramento: this.cloneEnding(encerramento),
    }));
  }

  failEnding(message: string): void {
    if (this.value().estado !== EstadoBatelada.Encerrando) {
      return;
    }
    this.value.update(snapshot => ({
      ...snapshot,
      estado: EstadoBatelada.BateladaIniciada,
      lastOperationalState: EstadoBatelada.BateladaIniciada,
      endingAsyncState: 'erro',
      errorMessage: message,
    }));
  }

  clear(): void {
    this.value.set(this.emptySnapshot());
  }

  restoreAfterStop(snapshot: ReportaBateladaWorkflowSnapshot): boolean {
    if (snapshot.estado !== EstadoBatelada.EmParada || !snapshot.batchId) {
      return false;
    }
    this.value.set(this.cloneSnapshot(snapshot));
    return this.returnFromStop();
  }

  private isLocked(): boolean {
    const state = this.value().estado;
    return [
      EstadoBatelada.Iniciando,
      EstadoBatelada.BateladaIniciada,
      EstadoBatelada.ReportandoParcial,
      EstadoBatelada.EmParada,
      EstadoBatelada.Encerrando,
      EstadoBatelada.Encerrada,
    ].includes(state);
  }

  private emptySnapshot(): ReportaBateladaWorkflowSnapshot {
    return {
      area: null,
      workCenter: null,
      orders: [],
      selectedOrderIds: [],
      composition: [],
      responsaveis: [],
      responsavel: null,
      estado: EstadoBatelada.ContextoPendente,
      asyncState: 'ocioso',
      lastOperationalState: EstadoBatelada.ContextoPendente,
      errorMessage: '',
      batchId: null,
      inicio: null,
      history: [],
      draft: null,
      reportAsyncState: 'ocioso',
      historyAsyncState: 'ocioso',
      endingAsyncState: 'ocioso',
      encerramento: null,
    };
  }

  private cloneSnapshot(snapshot: ReportaBateladaWorkflowSnapshot): ReportaBateladaWorkflowSnapshot {
    return {
      area: snapshot.area ? { ...snapshot.area } : null,
      workCenter: snapshot.workCenter ? { ...snapshot.workCenter } : null,
      orders: this.cloneOrders(snapshot.orders),
      selectedOrderIds: [...snapshot.selectedOrderIds],
      composition: this.cloneOrders(snapshot.composition),
      responsaveis: snapshot.responsaveis.map(responsavel => ({ ...responsavel })),
      responsavel: snapshot.responsavel ? { ...snapshot.responsavel } : null,
      estado: snapshot.estado,
      asyncState: snapshot.asyncState,
      lastOperationalState: snapshot.lastOperationalState,
      errorMessage: snapshot.errorMessage,
      batchId: snapshot.batchId,
      inicio: snapshot.inicio
        ? {
            batchId: snapshot.inicio.batchId,
            iniciadoEm: new Date(snapshot.inicio.iniciadoEm),
            ordensIniciadas: [...snapshot.inicio.ordensIniciadas],
          }
        : null,
      history: snapshot.history.map(report => this.cloneReport(report)),
      draft: snapshot.draft ? this.cloneDraft(snapshot.draft) : null,
      reportAsyncState: snapshot.reportAsyncState,
      historyAsyncState: snapshot.historyAsyncState,
      endingAsyncState: snapshot.endingAsyncState,
      encerramento: snapshot.encerramento ? this.cloneEnding(snapshot.encerramento) : null,
    };
  }

  private cloneOrders(orders: ReadonlyArray<OrdemLiberadaBatelada>): ReadonlyArray<OrdemLiberadaBatelada> {
    return orders.map(order => ({ ...order }));
  }

  private emptyDraft(
    composition: ReadonlyArray<OrdemLiberadaBatelada>,
  ): RascunhoReporteBatelada {
    return {
      idempotencyKey: null,
      items: composition.map(order => ({
        orderId: order.id,
        ordem: order.ordem,
        quantidadeAprovada: 0,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 0,
        refugoItens: [],
      })),
    };
  }

  private cloneDraft(draft: RascunhoReporteBatelada): RascunhoReporteBatelada {
    return {
      idempotencyKey: draft.idempotencyKey,
      items: draft.items.map(item => ({
        ...item,
        refugoItens: item.refugoItens.map(reason => ({ ...reason })),
      })),
    };
  }

  private cloneReport(report: ReporteParcialBatelada): ReporteParcialBatelada {
    return {
      ...report,
      confirmadoEm: new Date(report.confirmadoEm),
      items: this.cloneDraft({ idempotencyKey: null, items: report.items }).items,
    };
  }

  private cloneEnding(encerramento: EncerramentoBatelada): EncerramentoBatelada {
    return {
      ...encerramento,
      encerradoEm: new Date(encerramento.encerradoEm),
      ordensEncerradas: [...encerramento.ordensEncerradas],
    };
  }

  private dedupeReports(
    reports: ReadonlyArray<ReporteParcialBatelada>,
  ): ReadonlyArray<ReporteParcialBatelada> {
    const ids = new Set<string>();
    const keys = new Set<string>();
    return reports
      .filter(report => {
        if (ids.has(report.reporteId) || keys.has(report.idempotencyKey)) {
          return false;
        }
        ids.add(report.reporteId);
        keys.add(report.idempotencyKey);
        return true;
      })
      .map(report => this.cloneReport(report));
  }

  private draftFingerprint(draft: RascunhoReporteBatelada): string {
    return JSON.stringify(draft.items);
  }
}
