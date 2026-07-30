import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';
import {
  ProductionContext,
  ProductionContextOrigin,
  ResponsavelParada,
  StopEntry,
  StopId,
  StopReason,
  TipoResponsavelParada,
} from '../models/reporte-paradas.model';
import { formatLocalDate, formatLocalTime } from '../models/reporte-paradas-time';

export interface ParadaDraft {
  readonly reasonId: number | null;
  readonly startDate: Date | string | null;
  readonly startTime: string;
  readonly endDate: Date | string | null;
  readonly endTime: string;
  readonly programmed: boolean;
}

export interface ContextRequestToken {
  readonly generation: number;
  readonly identity: string;
}

export interface FinalizacaoDraft {
  readonly endDate: Date | string | null;
  readonly endTime: string;
}

export interface ReporteParadasWorkflowSnapshot {
  readonly area: AreaProducao | null;
  readonly workCenter: WorkCenter | null;
  readonly responsibleType: TipoResponsavelParada;
  readonly responsibleCode: string;
  readonly responsibles: ReadonlyArray<ResponsavelParada>;
  readonly reasons: ReadonlyArray<StopReason>;
  readonly draft: ParadaDraft;
  readonly dirty: boolean;
  readonly idempotencyKey: string | null;
  readonly origin?: ProductionContextOrigin;
  readonly metadata?: ProductionContext['metadata'];
  readonly contextLoading: boolean;
  readonly contextError: string;
  readonly saving: boolean;
  readonly openStops: ReadonlyArray<StopEntry>;
  readonly selectedStopId: StopId | null;
  readonly finishDraft: FinalizacaoDraft;
  readonly finishIdempotencyKey: string | null;
  readonly queryLoading: boolean;
  readonly queryError: string;
  readonly finishing: boolean;
  readonly finishError: string;
}

@Injectable()
export class ReporteParadasWorkflowState {
  private readonly authSession = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private currentRequest: ContextRequestToken | null = null;
  private currentQuery: ContextRequestToken | null = null;
  private currentFinish: ContextRequestToken | null = null;
  private view = this.initialState();

  constructor() {
    this.authSession.session$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((session) => {
      if (session === null) {
        this.resetTransient();
      }
    });
  }

  snapshot(): ReporteParadasWorkflowSnapshot {
    return this.cloneSnapshot(this.view);
  }

  emptyDraft(): ParadaDraft {
    return {
      reasonId: null,
      startDate: null,
      startTime: '',
      endDate: null,
      endTime: '',
      programmed: false,
    };
  }

  applyPrefill(
    context: ProductionContext,
    areas: ReadonlyArray<AreaProducao>,
    centers: ReadonlyArray<WorkCenter>,
    responsibles: ReadonlyArray<ResponsavelParada>,
  ): boolean {
    if (
      !context.workCenter.active ||
      !this.sameCode(context.workCenter.areaCode, context.area.code)
    ) {
      return false;
    }
    const area = areas.find((item) => this.sameCode(item.code, context.area.code));
    const center = centers.find(
      (item) =>
        item.active &&
        this.sameCode(item.code, context.workCenter.code) &&
        this.sameCode(item.areaCode, context.area.code),
    );
    if (!area || !center) {
      return false;
    }

    const preferred = context.preferredResponsible
      ? responsibles.find(
          (item) =>
            item.tipo === context.preferredResponsible?.tipo &&
            this.sameCode(item.codigo, context.preferredResponsible.codigo),
        )
      : undefined;

    this.invalidateRequests();
    this.view = {
      ...this.initialState(),
      area: { ...area },
      workCenter: { ...center },
      responsibleType: preferred?.tipo ?? 'OPERADOR',
      responsibleCode: preferred ? this.normalizeCode(preferred.codigo) : '',
      responsibles: responsibles.map((item) => ({
        ...item,
        codigo: this.normalizeCode(item.codigo),
      })),
      origin: context.origin ? { ...context.origin } : undefined,
      metadata: context.metadata ? this.cloneMetadata(context.metadata) : undefined,
    };
    return true;
  }

  confirmAreaChange(area: AreaProducao | null): void {
    this.invalidateRequests();
    this.view = {
      ...this.initialState(),
      area: area ? { ...area } : null,
    };
  }

  confirmWorkCenterChange(workCenter: WorkCenter | null): void {
    const area = this.view.area ? { ...this.view.area } : null;
    this.invalidateRequests();
    this.view = {
      ...this.initialState(),
      area,
      workCenter: workCenter ? { ...workCenter } : null,
    };
  }

  cancelContextChange(): void {
    // O parent controla o valor visual; cancelar intencionalmente não altera o snapshot.
  }

  beginContextRequest(areaCode: string, workCenterCode: string): ContextRequestToken {
    const token = {
      generation: ++this.generation,
      identity: this.contextIdentity(areaCode, workCenterCode),
    };
    this.currentRequest = token;
    this.view = {
      ...this.view,
      contextLoading: true,
      contextError: '',
    };
    return token;
  }

  acceptContextData(
    token: ContextRequestToken,
    responsibles: ReadonlyArray<ResponsavelParada>,
    reasons: ReadonlyArray<StopReason>,
  ): boolean {
    if (!this.isCurrent(token)) {
      return false;
    }
    this.view = {
      ...this.view,
      responsibles: this.uniqueResponsibles(responsibles),
      reasons: reasons.map((reason) => ({ ...reason })),
      contextLoading: false,
      contextError: '',
    };
    return true;
  }

  acceptContextError(token: ContextRequestToken, message: string): boolean {
    if (!this.isCurrent(token)) {
      return false;
    }
    this.view = {
      ...this.view,
      responsibles: [],
      reasons: [],
      contextLoading: false,
      contextError: message,
    };
    return true;
  }

  setResponsibleType(type: TipoResponsavelParada): void {
    if (this.view.responsibleType === type) {
      return;
    }
    this.view = {
      ...this.view,
      responsibleType: type,
      responsibleCode: '',
      dirty: true,
      idempotencyKey: null,
    };
  }

  setResponsibleCode(code: string): void {
    const responsibleCode = this.normalizeCode(code);
    if (this.view.responsibleCode === responsibleCode) {
      return;
    }
    this.view = {
      ...this.view,
      responsibleCode,
      dirty: true,
      idempotencyKey: null,
    };
  }

  updateDraft(change: Partial<ParadaDraft>): void {
    const draft = { ...this.view.draft, ...change };
    if (this.sameDraft(this.view.draft, draft)) {
      return;
    }
    this.view = {
      ...this.view,
      draft,
      dirty: true,
      idempotencyKey: null,
    };
  }

  ensureIdempotencyKey(factory: () => string): string {
    if (this.view.idempotencyKey) {
      return this.view.idempotencyKey;
    }
    const key = factory();
    this.view = { ...this.view, idempotencyKey: key };
    return key;
  }

  setSaving(saving: boolean): void {
    this.view = { ...this.view, saving };
  }

  beginOpenStopsQuery(areaCode: string, workCenterCode: string): ContextRequestToken {
    const token = this.newToken(areaCode, workCenterCode);
    this.currentQuery = token;
    this.view = { ...this.view, queryLoading: true, queryError: '' };
    return token;
  }

  acceptOpenStops(token: ContextRequestToken, stops: ReadonlyArray<StopEntry>): boolean {
    if (!this.isCurrentFor(this.currentQuery, token)) {
      return false;
    }
    const openStops = stops
      .filter((stop) => stop.status === 'EM_ANDAMENTO')
      .map((stop) => this.cloneStop(stop));
    const selectedStopId = openStops.some((stop) => stop.id === this.view.selectedStopId)
      ? this.view.selectedStopId
      : null;
    this.view = {
      ...this.view,
      openStops,
      selectedStopId,
      finishDraft: selectedStopId ? this.view.finishDraft : this.emptyFinishDraft(),
      finishIdempotencyKey: selectedStopId ? this.view.finishIdempotencyKey : null,
      queryLoading: false,
      queryError: '',
    };
    return true;
  }

  acceptOpenStopsError(token: ContextRequestToken, message: string): boolean {
    if (!this.isCurrentFor(this.currentQuery, token)) {
      return false;
    }
    this.view = { ...this.view, queryLoading: false, queryError: message };
    return true;
  }

  selectOpenStop(stopId: StopId, now: Date): boolean {
    if (!this.view.openStops.some((stop) => stop.id === stopId)) {
      return false;
    }
    if (this.view.selectedStopId === stopId) {
      return true;
    }
    this.view = {
      ...this.view,
      selectedStopId: stopId,
      finishDraft: {
        endDate: formatLocalDate(now),
        endTime: formatLocalTime(now),
      },
      finishIdempotencyKey: null,
      finishError: '',
    };
    return true;
  }

  clearOpenStopSelection(): void {
    this.view = {
      ...this.view,
      selectedStopId: null,
      finishDraft: this.emptyFinishDraft(),
      finishIdempotencyKey: null,
      finishError: '',
    };
  }

  updateFinishDraft(change: Partial<FinalizacaoDraft>): void {
    const next = { ...this.view.finishDraft, ...change };
    const changed =
      this.materialDate(this.view.finishDraft.endDate) !== this.materialDate(next.endDate) ||
      this.view.finishDraft.endTime.trim() !== next.endTime.trim();
    this.view = {
      ...this.view,
      finishDraft: next,
      finishIdempotencyKey: changed ? null : this.view.finishIdempotencyKey,
      finishError: changed ? '' : this.view.finishError,
    };
  }

  ensureFinishIdempotencyKey(factory: () => string): string {
    if (this.view.finishIdempotencyKey) {
      return this.view.finishIdempotencyKey;
    }
    const key = factory();
    this.view = { ...this.view, finishIdempotencyKey: key };
    return key;
  }

  setFinishing(finishing: boolean): void {
    this.view = { ...this.view, finishing };
  }

  beginFinishCommand(
    stopId: StopId,
    areaCode: string,
    workCenterCode: string,
  ): ContextRequestToken {
    const token = this.newToken(areaCode, workCenterCode, stopId);
    this.currentFinish = token;
    this.view = { ...this.view, finishing: true, finishError: '' };
    return token;
  }

  acceptFinishError(token: ContextRequestToken, message: string): boolean {
    if (!this.isCurrentFor(this.currentFinish, token)) {
      return false;
    }
    this.view = { ...this.view, finishing: false, finishError: message };
    return true;
  }

  acceptFinishSuccess(token: ContextRequestToken, stopId: StopId): boolean {
    if (!this.isCurrentFor(this.currentFinish, token) || this.view.selectedStopId !== stopId) {
      return false;
    }
    this.view = {
      ...this.view,
      openStops: this.view.openStops
        .filter((stop) => stop.id !== stopId)
        .map((stop) => this.cloneStop(stop)),
      selectedStopId: null,
      finishDraft: this.emptyFinishDraft(),
      finishIdempotencyKey: null,
      finishing: false,
      finishError: '',
    };
    return true;
  }

  completeRegistration(): void {
    this.view = {
      ...this.view,
      draft: this.emptyDraft(),
      dirty: false,
      idempotencyKey: null,
      saving: false,
    };
  }

  resetTransient(): void {
    this.invalidateRequests();
    this.view = this.initialState();
  }

  private initialState(): ReporteParadasWorkflowSnapshot {
    return {
      area: null,
      workCenter: null,
      responsibleType: 'OPERADOR',
      responsibleCode: '',
      responsibles: [],
      reasons: [],
      draft: this.emptyDraft(),
      dirty: false,
      idempotencyKey: null,
      contextLoading: false,
      contextError: '',
      saving: false,
      openStops: [],
      selectedStopId: null,
      finishDraft: this.emptyFinishDraft(),
      finishIdempotencyKey: null,
      queryLoading: false,
      queryError: '',
      finishing: false,
      finishError: '',
    };
  }

  private invalidateRequests(): void {
    this.generation += 1;
    this.currentRequest = null;
    this.currentQuery = null;
    this.currentFinish = null;
  }

  private isCurrent(token: ContextRequestToken): boolean {
    return this.isCurrentFor(this.currentRequest, token);
  }

  private isCurrentFor(current: ContextRequestToken | null, token: ContextRequestToken): boolean {
    return (
      current?.generation === token.generation &&
      current.identity === token.identity &&
      this.view.area !== null &&
      this.view.workCenter !== null &&
      token.identity === this.contextIdentity(this.view.area.code, this.view.workCenter.code)
    );
  }

  private newToken(
    areaCode: string,
    workCenterCode: string,
    _stopId?: StopId,
  ): ContextRequestToken {
    return {
      generation: ++this.generation,
      identity: this.contextIdentity(areaCode, workCenterCode),
    };
  }

  private uniqueResponsibles(
    responsibles: ReadonlyArray<ResponsavelParada>,
  ): ReadonlyArray<ResponsavelParada> {
    const unique = new Map<string, ResponsavelParada>();
    for (const responsible of responsibles) {
      const codigo = this.normalizeCode(responsible.codigo);
      unique.set(`${responsible.tipo}|${codigo}`, { ...responsible, codigo });
    }
    return [...unique.values()].map((item) => ({ ...item }));
  }

  private contextIdentity(areaCode: string, workCenterCode: string): string {
    return `${this.normalizeCode(areaCode)}|${this.normalizeCode(workCenterCode)}`;
  }

  private sameCode(left: string, right: string): boolean {
    return this.normalizeCode(left) === this.normalizeCode(right);
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private cloneSnapshot(snapshot: ReporteParadasWorkflowSnapshot): ReporteParadasWorkflowSnapshot {
    return {
      ...snapshot,
      area: snapshot.area ? { ...snapshot.area } : null,
      workCenter: snapshot.workCenter ? { ...snapshot.workCenter } : null,
      responsibles: snapshot.responsibles.map((item) => ({ ...item })),
      reasons: snapshot.reasons.map((item) => ({ ...item })),
      draft: {
        ...snapshot.draft,
        startDate:
          snapshot.draft.startDate instanceof Date
            ? new Date(snapshot.draft.startDate)
            : snapshot.draft.startDate,
        endDate:
          snapshot.draft.endDate instanceof Date
            ? new Date(snapshot.draft.endDate)
            : snapshot.draft.endDate,
      },
      origin: snapshot.origin ? { ...snapshot.origin } : undefined,
      metadata: snapshot.metadata ? this.cloneMetadata(snapshot.metadata) : undefined,
      openStops: snapshot.openStops.map((stop) => this.cloneStop(stop)),
      finishDraft: {
        ...snapshot.finishDraft,
        endDate:
          snapshot.finishDraft.endDate instanceof Date
            ? new Date(snapshot.finishDraft.endDate)
            : snapshot.finishDraft.endDate,
      },
    };
  }

  private emptyFinishDraft(): FinalizacaoDraft {
    return { endDate: null, endTime: '' };
  }

  private materialDate(value: Date | string | null): string {
    return value instanceof Date ? formatLocalDate(value) : String(value ?? '').trim();
  }

  private sameDraft(left: ParadaDraft, right: ParadaDraft): boolean {
    return (
      left.reasonId === right.reasonId &&
      this.materialDate(left.startDate) === this.materialDate(right.startDate) &&
      left.startTime.trim() === right.startTime.trim() &&
      this.materialDate(left.endDate) === this.materialDate(right.endDate) &&
      left.endTime.trim() === right.endTime.trim() &&
      left.programmed === right.programmed
    );
  }

  private cloneMetadata(
    metadata: ProductionContext['metadata'],
  ): NonNullable<ProductionContext['metadata']> {
    return {
      ...metadata,
      ...(metadata?.orderIds ? { orderIds: [...metadata.orderIds] } : {}),
    };
  }

  private cloneStop(stop: StopEntry): StopEntry {
    return {
      ...stop,
      context: {
        ...stop.context,
        area: { ...stop.context.area },
        workCenter: { ...stop.context.workCenter },
        origin: stop.context.origin ? { ...stop.context.origin } : undefined,
        preferredResponsible: stop.context.preferredResponsible
          ? { ...stop.context.preferredResponsible }
          : undefined,
        metadata: stop.context.metadata
          ? {
              ...stop.context.metadata,
              orderIds: stop.context.metadata.orderIds
                ? [...stop.context.metadata.orderIds]
                : undefined,
            }
          : undefined,
      },
      reason: { ...stop.reason },
      responsible: { ...stop.responsible },
      startDate: new Date(stop.startDate),
      endDate: stop.endDate ? new Date(stop.endDate) : undefined,
    };
  }
}
