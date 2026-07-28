import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of, throwError } from 'rxjs';

import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';
import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import { CreateStopRequest } from '../interfaces/reporte-paradas.dto';
import {
  ProductionContext,
  ResponsavelParada,
  StopEntry,
  StopReason,
  StopSaveResult,
} from '../models/reporte-paradas.model';

@Injectable({ providedIn: 'root' })
export class ReporteParadasService {
  private readonly catalog = inject(ProductionContextCatalogService);
  private prefillContext: ProductionContext | null = null;
  private nextStopId = 1;
  private readonly confirmedStops: StopEntry[] = [];

  private readonly reasons: ReadonlyArray<StopReason> = Object.freeze([
    { id: 1, code: '01', description: 'Setup' },
    { id: 2, code: '02', description: 'Almoço' },
    { id: 5, code: '05', description: 'Reunião' },
    { id: 8, code: '08', description: 'Manutenção' },
    { id: 12, code: '12', description: 'Falta de material' },
    { id: 15, code: '15', description: 'Troca Turno' },
  ]);

  listarAreas(): Observable<ReadonlyArray<AreaProducao>> {
    return this.catalog.listarAreas().pipe(
      map(areas => areas.map(area => ({ ...area }))),
    );
  }

  pesquisarCentros(areaCode: string, termo = ''): Observable<ReadonlyArray<WorkCenter>> {
    return this.catalog.pesquisarCentros(areaCode, termo).pipe(
      map(centers => centers.map(center => ({ ...center }))),
    );
  }

  listarResponsaveis(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<ResponsavelParada>> {
    return this.catalog.listarResponsaveis(areaCode, workCenterCode).pipe(
      map(responsaveis => responsaveis.map(responsavel => ({ ...responsavel }))),
    );
  }

  listarMotivos(
    _areaCode: string,
    _workCenterCode: string,
  ): Observable<ReadonlyArray<StopReason>> {
    return of(this.reasons.map(reason => ({ ...reason }))).pipe(delay(150));
  }

  setPrefillContext(context: ProductionContext): void {
    this.prefillContext = this.cloneContext(context);
  }

  getPrefillContext(): ProductionContext | null {
    return this.prefillContext ? this.cloneContext(this.prefillContext) : null;
  }

  clearPrefillContext(): void {
    this.prefillContext = null;
  }

  registrarParada(_request: CreateStopRequest): Observable<StopEntry> {
    return throwError(() => new Error('O comando de registro ainda não foi validado.'));
  }

  // Compatibilidade transitória da UI legada; removida na composição da nova página.
  getActiveContext(): ProductionContext | null {
    return this.getPrefillContext();
  }

  listReasons(): Observable<ReadonlyArray<StopReason>> {
    const context = this.prefillContext;
    return this.listarMotivos(context?.area.code ?? '', context?.workCenter.code ?? '');
  }

  createStop(reason: StopReason, now = new Date()): StopEntry {
    const context = this.prefillContext;
    const responsible = context?.preferredResponsible;
    if (!context || !responsible) {
      throw new Error('Informe contexto e responsável antes de registrar a parada.');
    }

    return {
      id: this.nextStopId++,
      context: this.cloneContext(context),
      reason: { ...reason },
      responsible: { ...responsible },
      startDate: new Date(now),
      startTime: this.formatTime(now),
      endTime: '',
      programmed: false,
      status: 'EM_ANDAMENTO',
      idempotencyKey: `stop-draft-${this.nextStopId}`,
      syncStatus: 'PENDING',
    };
  }

  calculateDurationMinutes(stop: StopEntry): number {
    const start = this.combineDateAndTime(stop.startDate, stop.startTime);
    const end = stop.endDate ? this.combineDateAndTime(stop.endDate, stop.endTime) : null;
    return start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : 0;
  }

  formatDuration(stop: StopEntry): string {
    const minutes = this.calculateDurationMinutes(stop);
    return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:00`;
  }

  validateStops(stops: ReadonlyArray<StopEntry>, context: ProductionContext | null): string {
    if (!context) {
      return 'Informe a Área de Produção e o Centro de Trabalho.';
    }
    return stops.length === 0 ? 'Adicione ao menos um motivo de parada.' : '';
  }

  saveStops(_context: ProductionContext, stops: ReadonlyArray<StopEntry>): Observable<StopSaveResult> {
    this.confirmedStops.push(...stops.map(stop => this.cloneStop(stop)));
    return of({
      protocol: `PAR-${Date.now()}`,
      savedAt: new Date(),
    }).pipe(delay(300));
  }

  private cloneContext(context: ProductionContext): ProductionContext {
    return {
      area: { ...context.area },
      workCenter: { ...context.workCenter },
      origin: context.origin ? { ...context.origin } : undefined,
      preferredResponsible: context.preferredResponsible
        ? { ...context.preferredResponsible }
        : undefined,
      metadata: context.metadata
        ? {
            ...context.metadata,
            orderIds: context.metadata.orderIds ? [...context.metadata.orderIds] : undefined,
          }
        : undefined,
    };
  }

  private cloneStop(stop: StopEntry): StopEntry {
    return {
      ...stop,
      context: this.cloneContext(stop.context),
      reason: { ...stop.reason },
      responsible: { ...stop.responsible },
      startDate: new Date(stop.startDate),
      endDate: stop.endDate ? new Date(stop.endDate) : undefined,
    };
  }

  private combineDateAndTime(date: Date, time: string): Date | null {
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!match || !Number.isFinite(date.getTime())) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      return null;
    }
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
  }

  private formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}
