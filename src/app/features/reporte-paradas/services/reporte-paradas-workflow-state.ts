import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';
import {
  ProductionContext,
  ProductionContextOrigin,
  ResponsavelParada,
  StopReason,
  TipoResponsavelParada,
} from '../models/reporte-paradas.model';

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
  readonly contextLoading: boolean;
  readonly contextError: string;
  readonly saving: boolean;
  readonly querySelectionIds: ReadonlyArray<string>;
}

@Injectable()
export class ReporteParadasWorkflowState {
  private readonly authSession = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private currentRequest: ContextRequestToken | null = null;
  private view = this.initialState();

  constructor() {
    this.authSession.session$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(session => {
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
    if (!context.workCenter.active
      || !this.sameCode(context.workCenter.areaCode, context.area.code)) {
      return false;
    }
    const area = areas.find(item => this.sameCode(item.code, context.area.code));
    const center = centers.find(item =>
      item.active
      && this.sameCode(item.code, context.workCenter.code)
      && this.sameCode(item.areaCode, context.area.code),
    );
    if (!area || !center) {
      return false;
    }

    const preferred = context.preferredResponsible
      ? responsibles.find(item =>
          item.tipo === context.preferredResponsible?.tipo
          && this.sameCode(item.codigo, context.preferredResponsible.codigo),
        )
      : undefined;

    this.invalidateRequests();
    this.view = {
      ...this.initialState(),
      area: { ...area },
      workCenter: { ...center },
      responsibleType: preferred?.tipo ?? 'OPERADOR',
      responsibleCode: preferred ? this.normalizeCode(preferred.codigo) : '',
      responsibles: responsibles.map(item => ({ ...item, codigo: this.normalizeCode(item.codigo) })),
      origin: context.origin ? { ...context.origin } : undefined,
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
    const origin = this.view.origin ? { ...this.view.origin } : undefined;
    this.invalidateRequests();
    this.view = {
      ...this.initialState(),
      area,
      workCenter: workCenter ? { ...workCenter } : null,
      origin,
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
      reasons: reasons.map(reason => ({ ...reason })),
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
    this.view = {
      ...this.view,
      responsibleType: type,
      responsibleCode: '',
      dirty: true,
      idempotencyKey: null,
    };
  }

  setResponsibleCode(code: string): void {
    this.view = {
      ...this.view,
      responsibleCode: this.normalizeCode(code),
      dirty: true,
      idempotencyKey: null,
    };
  }

  updateDraft(change: Partial<ParadaDraft>): void {
    this.view = {
      ...this.view,
      draft: { ...this.view.draft, ...change },
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

  setQuerySelection(ids: ReadonlyArray<string>): void {
    this.view = { ...this.view, querySelectionIds: [...ids] };
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
      querySelectionIds: [],
    };
  }

  private invalidateRequests(): void {
    this.generation += 1;
    this.currentRequest = null;
  }

  private isCurrent(token: ContextRequestToken): boolean {
    return this.currentRequest?.generation === token.generation
      && this.currentRequest.identity === token.identity
      && this.view.area !== null
      && this.view.workCenter !== null
      && token.identity === this.contextIdentity(this.view.area.code, this.view.workCenter.code);
  }

  private uniqueResponsibles(
    responsibles: ReadonlyArray<ResponsavelParada>,
  ): ReadonlyArray<ResponsavelParada> {
    const unique = new Map<string, ResponsavelParada>();
    for (const responsible of responsibles) {
      const codigo = this.normalizeCode(responsible.codigo);
      unique.set(`${responsible.tipo}|${codigo}`, { ...responsible, codigo });
    }
    return [...unique.values()].map(item => ({ ...item }));
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

  private cloneSnapshot(
    snapshot: ReporteParadasWorkflowSnapshot,
  ): ReporteParadasWorkflowSnapshot {
    return {
      ...snapshot,
      area: snapshot.area ? { ...snapshot.area } : null,
      workCenter: snapshot.workCenter ? { ...snapshot.workCenter } : null,
      responsibles: snapshot.responsibles.map(item => ({ ...item })),
      reasons: snapshot.reasons.map(item => ({ ...item })),
      draft: {
        ...snapshot.draft,
        startDate: snapshot.draft.startDate instanceof Date
          ? new Date(snapshot.draft.startDate)
          : snapshot.draft.startDate,
        endDate: snapshot.draft.endDate instanceof Date
          ? new Date(snapshot.draft.endDate)
          : snapshot.draft.endDate,
      },
      origin: snapshot.origin ? { ...snapshot.origin } : undefined,
      querySelectionIds: [...snapshot.querySelectionIds],
    };
  }
}
