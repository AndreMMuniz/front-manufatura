import { Injectable, inject } from '@angular/core';
import { Observable, defer, delay, finalize, forkJoin, map, of } from 'rxjs';

import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';
import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import { CreateStopRequest, FinishStopRequest } from '../interfaces/reporte-paradas.dto';
import {
  ProductionContext,
  ResponsavelParada,
  StopEntry,
  StopReason,
} from '../models/reporte-paradas.model';
import {
  combineLocalDateTime,
  durationMinutes,
  parseLocalDate,
  validateStopInterval,
} from '../models/reporte-paradas-time';

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
  private readonly finishesByIdempotency = new Map<
    string,
    { readonly fingerprint: string; readonly stop: StopEntry }
  >();
  private registrationInFlight = false;
  private finishInFlight = false;
  private activeStopContext: { readonly areaCode: string; readonly workCenterCode: string } | null = null;

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
      if (this.registrationInFlight) {
        throw new Error('Já existe um registro de parada em andamento.');
      }
      this.registrationInFlight = true;

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

          const derivedDuration = validated.end
            ? durationMinutes(validated.start, validated.end)
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
            endTime: validated.end ? command.endTime!.trim() : undefined,
            programmed: command.programmed,
            status: validated.end ? 'FINALIZADA' : 'EM_ANDAMENTO',
            durationMinutes: derivedDuration,
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
        this.registrationInFlight = false;
      }),
    );
  }

  listarParadasEmAndamento(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<StopEntry>> {
    return defer(() => {
      const area = this.normalizeCode(areaCode);
      const workCenter = this.normalizeCode(workCenterCode);
      this.activeStopContext = { areaCode: area, workCenterCode: workCenter };
      return of(this.confirmedStops
        .filter(stop =>
          stop.status === 'EM_ANDAMENTO'
          && this.sameCode(stop.context.area.code, area)
          && this.sameCode(stop.context.workCenter.code, workCenter),
        )
        .map(stop => this.cloneStop(stop)));
    }).pipe(delay(150));
  }

  finalizarParada(stopId: number, request: FinishStopRequest): Observable<StopEntry> {
    return defer(() => {
      if (this.finishInFlight) {
        throw new Error('Já existe uma finalização de parada em andamento.');
      }
      this.finishInFlight = true;
      const command = this.cloneFinishRequest(request);
      if (!command.idempotencyKey.trim()) {
        throw new Error('A chave de idempotência da finalização é obrigatória.');
      }
      const end = combineLocalDateTime(command.endDate, command.endTime);
      if (!end) {
        throw new Error('Informe Data da Finalização e Hora da Finalização válidas.');
      }
      const fingerprint = JSON.stringify({ stopId, end: end.toISOString() });
      const prior = this.finishesByIdempotency.get(command.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new Error('A chave de idempotência já foi usada com outro conteúdo.');
        }
        return of(this.cloneStop(prior.stop));
      }

      const index = this.confirmedStops.findIndex(stop => stop.id === stopId);
      const current = index >= 0 ? this.confirmedStops[index] : undefined;
      if (!current) {
        throw new Error('A parada não existe ou não está mais disponível.');
      }
      if (current.status !== 'EM_ANDAMENTO') {
        throw new Error('A parada já foi finalizada e não pode receber um novo comando.');
      }
      if (!this.activeStopContext
        || !this.sameCode(current.context.area.code, this.activeStopContext.areaCode)
        || !this.sameCode(current.context.workCenter.code, this.activeStopContext.workCenterCode)) {
        throw new Error('A parada não pertence ao contexto corrente.');
      }
      const interval = validateStopInterval(
        current.startDate,
        current.startTime,
        command.endDate,
        command.endTime,
      );
      if (!interval) {
        throw new Error('A finalização não pode ser anterior ao início da parada.');
      }

      const finished: StopEntry = {
        ...this.cloneStop(current),
        endDate: new Date(interval.end.getFullYear(), interval.end.getMonth(), interval.end.getDate()),
        endTime: command.endTime.trim(),
        status: 'FINALIZADA',
        durationMinutes: durationMinutes(interval.start, interval.end),
        syncStatus: 'PENDING',
      };
      const stored = this.cloneStop(finished);
      this.confirmedStops[index] = stored;
      this.finishesByIdempotency.set(command.idempotencyKey, {
        fingerprint,
        stop: this.cloneStop(stored),
      });
      return of(this.cloneStop(stored));
    }).pipe(
      finalize(() => {
        this.finishInFlight = false;
      }),
    );
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

  private cloneFinishRequest(request: FinishStopRequest): FinishStopRequest {
    return {
      ...request,
      endDate: request.endDate instanceof Date ? new Date(request.endDate) : request.endDate,
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

    const startDate = parseLocalDate(command.startDate);
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

    const start = combineLocalDateTime(startDate, command.startTime)!;
    let end: Date | null = null;
    if (hasEndDate && hasEndTime) {
      const endDate = parseLocalDate(command.endDate!);
      if (!endDate) {
        throw new Error('Informe uma Data Final válida.');
      }
      if (!this.isValidTime(command.endTime!)) {
        throw new Error('Informe uma Hora Final válida no formato HH:mm.');
      }
      end = combineLocalDateTime(endDate, command.endTime!)!;
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

}
