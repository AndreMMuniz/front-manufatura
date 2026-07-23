import { Injectable, Optional, signal } from '@angular/core';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { WorkCenter } from '../../shop-floor/models/work-center';
import {
  AreaProducaoBatelada,
  EstadoAssincronoBatelada,
  EstadoBatelada,
  InicioBatelada,
  OrdemLiberadaBatelada,
  ResponsavelBatelada,
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
  readonly inicio: InicioBatelada | null;
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
      inicio: {
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

  clear(): void {
    this.value.set(this.emptySnapshot());
  }

  private isLocked(): boolean {
    const state = this.value().estado;
    return state === EstadoBatelada.Iniciando || state === EstadoBatelada.BateladaIniciada;
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
      inicio: null,
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
      inicio: snapshot.inicio
        ? {
            iniciadoEm: new Date(snapshot.inicio.iniciadoEm),
            ordensIniciadas: [...snapshot.inicio.ordensIniciadas],
          }
        : null,
    };
  }

  private cloneOrders(orders: ReadonlyArray<OrdemLiberadaBatelada>): ReadonlyArray<OrdemLiberadaBatelada> {
    return orders.map(order => ({ ...order }));
  }
}
