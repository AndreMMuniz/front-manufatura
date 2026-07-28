import { Injectable, inject } from '@angular/core';
import { Observable, defer, delay, finalize, forkJoin, map, of } from 'rxjs';

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
  private readonly registrationsByIdempotency = new Map<
    string,
    { readonly fingerprint: string; readonly stop: StopEntry }
  >();
  private commandInFlight = false;

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

  registrarParada(request: CreateStopRequest): Observable<StopEntry> {
    return defer(() => {
      if (this.commandInFlight) {
        throw new Error('Já existe um registro de parada em andamento.');
      }
      this.commandInFlight = true;

      const command = this.cloneRequest(request);
      const validated = this.validateCommand(command);
      const fingerprint = this.commandFingerprint(command, validated.start, validated.end);
      const prior = this.registrationsByIdempotency.get(command.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new Error('A chave de idempotência já foi usada com outro conteúdo.');
        }
        return of(this.cloneStop(prior.stop));
      }

      return forkJoin({
        areas: this.listarAreas(),
        centers: this.pesquisarCentros(command.areaCode),
        responsibles: this.listarResponsaveis(command.areaCode, command.workCenterCode),
      }).pipe(
        map(({ areas, centers, responsibles }) => {
          const area = areas.find(item => this.sameCode(item.code, command.areaCode));
          const center = centers.find(item =>
            item.active
            && this.sameCode(item.code, command.workCenterCode)
            && this.sameCode(item.areaCode, command.areaCode),
          );
          if (!area || !center) {
            throw new Error('Informe uma Área de Produção e um Centro de Trabalho válidos.');
          }

          const responsible = responsibles.find(item =>
            item.tipo === command.responsible.tipo
            && this.sameCode(item.codigo, command.responsible.codigo),
          );
          if (!responsible) {
            throw new Error('Selecione um responsável elegível para a Área e o Centro de Trabalho.');
          }

          const durationMinutes = validated.end
            ? Math.round((validated.end.getTime() - validated.start.getTime()) / 60000)
            : undefined;
          const stop: StopEntry = {
            id: this.nextStopId++,
            context: {
              area: { ...area },
              workCenter: { ...center },
              origin: command.origin ? { ...command.origin } : undefined,
              preferredResponsible: { ...responsible },
              metadata: { machineGroup: center.machineGroup },
            },
            reason: { ...validated.reason },
            responsible: { ...responsible, codigo: this.normalizeCode(responsible.codigo) },
            startDate: this.dateOnly(validated.start),
            startTime: command.startTime.trim(),
            endDate: validated.end ? this.dateOnly(validated.end) : undefined,
            endTime: validated.end ? command.endTime!.trim() : '',
            programmed: command.programmed,
            status: validated.end ? 'FINALIZADA' : 'EM_ANDAMENTO',
            durationMinutes,
            idempotencyKey: command.idempotencyKey,
            syncStatus: 'PENDING',
          };
          const stored = this.cloneStop(stop);
          this.registrationsByIdempotency.set(command.idempotencyKey, { fingerprint, stop: stored });
          this.confirmedStops.push(this.cloneStop(stored));
          return this.cloneStop(stored);
        }),
      );
    }).pipe(
      finalize(() => {
        this.commandInFlight = false;
      }),
    );
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

  private cloneRequest(request: CreateStopRequest): CreateStopRequest {
    return {
      ...request,
      responsible: { ...request.responsible },
      startDate: request.startDate instanceof Date ? new Date(request.startDate) : request.startDate,
      endDate: request.endDate instanceof Date ? new Date(request.endDate) : request.endDate,
      origin: request.origin ? { ...request.origin } : undefined,
    };
  }

  private validateCommand(command: CreateStopRequest): {
    readonly reason: StopReason;
    readonly start: Date;
    readonly end: Date | null;
  } {
    if (!this.normalizeCode(command.areaCode) || !this.normalizeCode(command.workCenterCode)) {
      throw new Error('Informe a Área de Produção e o Centro de Trabalho.');
    }
    if (!this.normalizeCode(command.responsible.codigo)) {
      throw new Error('Selecione um responsável elegível.');
    }
    if (!command.idempotencyKey.trim()) {
      throw new Error('A chave de idempotência é obrigatória.');
    }

    const reason = this.reasons.find(item => item.id === command.reasonId);
    if (!reason) {
      throw new Error('Selecione um motivo corporativo válido.');
    }

    const startDate = this.normalizeDate(command.startDate);
    if (!startDate) {
      throw new Error('Informe uma Data Inicial válida.');
    }
    if (!this.isValidTime(command.startTime)) {
      throw new Error('Informe uma Hora Inicial válida no formato HH:mm.');
    }

    const hasEndDate = command.endDate instanceof Date
      || (typeof command.endDate === 'string' && command.endDate.trim().length > 0);
    const hasEndTime = typeof command.endTime === 'string' && command.endTime.trim().length > 0;
    if (hasEndDate !== hasEndTime) {
      throw new Error('Data Final e Hora Final devem ser informadas juntas ou deixadas vazias.');
    }

    const start = this.combineDateAndTime(startDate, command.startTime)!;
    let end: Date | null = null;
    if (hasEndDate && hasEndTime) {
      const endDate = this.normalizeDate(command.endDate!);
      if (!endDate) {
        throw new Error('Informe uma Data Final válida.');
      }
      if (!this.isValidTime(command.endTime!)) {
        throw new Error('Informe uma Hora Final válida no formato HH:mm.');
      }
      end = this.combineDateAndTime(endDate, command.endTime!)!;
      if (end.getTime() < start.getTime()) {
        throw new Error('O fim da parada não pode ser anterior ao início.');
      }
    }

    return { reason: { ...reason }, start, end };
  }

  private commandFingerprint(command: CreateStopRequest, start: Date, end: Date | null): string {
    return JSON.stringify({
      areaCode: this.normalizeCode(command.areaCode),
      workCenterCode: this.normalizeCode(command.workCenterCode),
      reasonId: command.reasonId,
      responsible: {
        tipo: command.responsible.tipo,
        codigo: this.normalizeCode(command.responsible.codigo),
      },
      start: start.toISOString(),
      end: end?.toISOString() ?? null,
      programmed: command.programmed,
      origin: command.origin ?? null,
    });
  }

  private normalizeDate(value: Date | string): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : this.dateOnly(value);
    }
    const text = value.trim();
    const localMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (localMatch) {
      const year = Number(localMatch[1]);
      const month = Number(localMatch[2]);
      const day = Number(localMatch[3]);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? date
        : null;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : this.dateOnly(parsed);
  }

  private isValidTime(value: string): boolean {
    const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
    return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
  }

  private dateOnly(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private sameCode(left: string, right: string): boolean {
    return this.normalizeCode(left) === this.normalizeCode(right);
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
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
