import { Injectable, inject } from '@angular/core';
import { Observable, defer, delay, finalize, forkJoin, from, map, of, switchMap } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { LocalRecordRepository } from '../../../core/offline/repositories/local-record.repository';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
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
  formatLocalDate,
  formatLocalTime,
  parseLocalDate,
  validateStopInterval,
} from '../models/reporte-paradas-time';

@Injectable({ providedIn: 'root' })
export class ReporteParadasService {
  private readonly catalog = inject(ProductionContextCatalogService);
  private readonly commands = inject(OperationalCommandFacade);
  private readonly localRecords = inject(LocalRecordRepository);
  private readonly authSession = inject(AuthSessionService);
  private prefillContext: ProductionContext | null = null;
  private readonly confirmedStops: StopEntry[] = [];
  private cacheOwnerId: string | null = null;
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
      const ownerId = this.authSession.currentUser?.id.trim();
      if (!ownerId) {
        throw new Error('É necessária uma sessão autenticada para registrar a parada.');
      }
      return from(
        this.localRecords.getByIdempotencyKey(ownerId, command.idempotencyKey),
      ).pipe(switchMap(existing => {
        if (existing?.commandType === 'CREATE_STOP') {
          const restored = this.stopFromPayload(existing.payload, existing.idempotencyKey);
          if (restored) {
            this.ensureOwnerCache(ownerId);
            const existingIndex =
              this.confirmedStops.findIndex(item => item.localId === restored.localId);
            if (existingIndex >= 0) this.confirmedStops[existingIndex] = restored;
            else this.confirmedStops.push(restored);
            return of(this.cloneStop(restored));
          }
        }
        return forkJoin({
          areas: this.listarAreas(),
          centers: this.pesquisarCentros(command.areaCode),
          responsibles: this.listarResponsaveis(command.areaCode, command.workCenterCode),
        });
      }), switchMap(result => {
        if (!('areas' in result)) {
          return of(result);
        }
        const { areas, centers, responsibles } = result;
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
          const localId = command.idempotencyKey;
          const stop: StopEntry = {
            id: localId,
            localId,
            creationCommandId: command.idempotencyKey,
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
          return from(this.commands.capture({
            commandType: 'CREATE_STOP',
            aggregateId: localId,
            businessStatus: stop.status,
            idempotencyKey: command.idempotencyKey,
            occurredAt: validated.start.toISOString(),
            payload: this.stopPayload(stop),
          })).pipe(map(confirmation => {
            this.ensureOwnerCache(this.authSession.currentUser?.id ?? '');
            const stored = this.cloneStop(stop);
            const confirmedStop: StopEntry = {
              ...stored,
              id: confirmation.localId,
              localId: confirmation.localId,
              syncStatus: confirmation.syncStatus,
            };
            const existingIndex = this.confirmedStops.findIndex(item => item.localId === localId);
            if (existingIndex >= 0) {
              this.confirmedStops[existingIndex] = confirmedStop;
            } else {
              this.confirmedStops.push(confirmedStop);
            }
            return this.cloneStop(confirmedStop);
          }));
      }));
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
      const ownerId = this.authSession.currentUser?.id;
      if (!ownerId) {
        this.ensureOwnerCache('');
        return of([]);
      }
      return from(this.localRecords.listByOwner(ownerId)).pipe(
        map(records => {
          this.ensureOwnerCache(ownerId);
          this.confirmedStops.splice(0);
          for (const record of records.filter(item => item.commandType === 'CREATE_STOP')) {
            const restored = this.stopFromPayload(record.payload, record.localId);
            if (restored) {
              this.confirmedStops.push(restored);
            }
          }
          for (const record of records.filter(item => item.commandType === 'FINISH_STOP')) {
            this.applyDurableFinish(record.payload, record.idempotencyKey);
          }
          return this.openStopsForContext(area, workCenter);
        }),
      );
    }).pipe(delay(150));
  }

  finalizarParada(stopId: string | number, request: FinishStopRequest): Observable<StopEntry> {
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
      const index = this.confirmedStops.findIndex(stop => stop.id === stopId);
      const current = index >= 0 ? this.confirmedStops[index] : undefined;
      if (!current) {
        throw new Error('A parada não existe ou não está mais disponível.');
      }
      if (current.status !== 'EM_ANDAMENTO') {
        if (current.finishCommandId === command.idempotencyKey) {
          return from(this.captureFinish(current, command.idempotencyKey, end))
            .pipe(map(() => this.cloneStop(current)));
        }
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
        finishCommandId: command.idempotencyKey,
        endDate: new Date(interval.end.getFullYear(), interval.end.getMonth(), interval.end.getDate()),
        endTime: command.endTime.trim(),
        status: 'FINALIZADA',
        durationMinutes: durationMinutes(interval.start, interval.end),
        syncStatus: 'PENDING',
      };
      return from(this.captureFinish(current, command.idempotencyKey, end)).pipe(map(() => {
        const stored = this.cloneStop(finished);
        this.confirmedStops[index] = stored;
        return this.cloneStop(stored);
      }));
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

  private openStopsForContext(areaCode: string, workCenterCode: string): readonly StopEntry[] {
    return this.confirmedStops
      .filter(stop =>
        stop.status === 'EM_ANDAMENTO'
        && this.sameCode(stop.context.area.code, areaCode)
        && this.sameCode(stop.context.workCenter.code, workCenterCode),
      )
      .map(stop => this.cloneStop(stop));
  }

  private stopPayload(stop: StopEntry) {
    return {
      localId: stop.localId ?? stop.idempotencyKey,
      context: {
        area: { ...stop.context.area },
        workCenter: { ...stop.context.workCenter },
        ...(stop.context.origin ? { origin: { ...stop.context.origin } } : {}),
        ...(stop.context.preferredResponsible
          ? { preferredResponsible: { ...stop.context.preferredResponsible } }
          : {}),
        ...(stop.context.metadata
          ? {
              metadata: {
                ...stop.context.metadata,
                orderIds: stop.context.metadata.orderIds
                  ? [...stop.context.metadata.orderIds]
                  : [],
              },
            }
          : {}),
      },
      reason: { ...stop.reason },
      responsible: { ...stop.responsible },
      startDate: formatLocalDate(stop.startDate),
      startTime: stop.startTime,
      endDate: stop.endDate ? formatLocalDate(stop.endDate) : null,
      endTime: stop.endTime ?? null,
      programmed: stop.programmed,
      status: stop.status,
      durationMinutes: stop.durationMinutes ?? null,
    } as const;
  }

  private stopFromPayload(payload: unknown, creationCommandId: string): StopEntry | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const value = payload as Record<string, unknown>;
    const context = value['context'];
    const reason = value['reason'];
    const responsible = value['responsible'];
    const startDate = this.parsePersistedLocalDate(value['startDate']);
    const endDate = value['endDate']
      ? this.parsePersistedLocalDate(value['endDate'])
      : null;
    if (
      !this.isValidPersistedContext(context)
      || !this.isValidPersistedReason(reason)
      || !this.isValidPersistedResponsible(responsible)
      || !startDate
      || (value['endDate'] !== null && value['endDate'] !== undefined && !endDate)
      || typeof value['startTime'] !== 'string'
      || !this.isValidTime(value['startTime'])
      || (value['endTime'] !== null
        && value['endTime'] !== undefined
        && (typeof value['endTime'] !== 'string' || !this.isValidTime(value['endTime'])))
    ) {
      return null;
    }
    const localId = String(value['localId'] ?? creationCommandId);
    return {
      id: localId,
      localId,
      creationCommandId,
      context: this.cloneContext(context),
      reason: { ...reason },
      responsible: { ...responsible },
      startDate,
      startTime: String(value['startTime'] ?? ''),
      ...(endDate ? { endDate } : {}),
      ...(value['endTime'] ? { endTime: String(value['endTime']) } : {}),
      programmed: Boolean(value['programmed']),
      status: value['status'] === 'FINALIZADA' ? 'FINALIZADA' : 'EM_ANDAMENTO',
      ...(typeof value['durationMinutes'] === 'number'
        ? { durationMinutes: value['durationMinutes'] }
        : {}),
      idempotencyKey: creationCommandId,
      syncStatus: 'PENDING',
    };
  }

  private ensureOwnerCache(ownerId: string): void {
    const normalized = ownerId.trim();
    if (this.cacheOwnerId === normalized) return;
    this.confirmedStops.splice(0);
    this.cacheOwnerId = normalized || null;
  }

  private applyDurableFinish(payload: unknown, finishCommandId: string): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const value = payload as Record<string, unknown>;
    const localId = typeof value['stopLocalId'] === 'string' ? value['stopLocalId'] : '';
    const persistedEndDate = this.parsePersistedLocalDate(value['endDate']);
    const persistedEndTime =
      typeof value['endTime'] === 'string' && this.isValidTime(value['endTime'])
        ? value['endTime']
        : null;
    const legacyEnd = typeof value['endAt'] === 'string' ? new Date(value['endAt']) : null;
    const end = persistedEndDate && persistedEndTime
      ? combineLocalDateTime(persistedEndDate, persistedEndTime)
      : legacyEnd;
    const index = this.confirmedStops.findIndex(stop => stop.localId === localId);
    if (index < 0 || !end || Number.isNaN(end.getTime())) {
      return;
    }
    const current = this.confirmedStops[index];
    const interval = validateStopInterval(
      current.startDate,
      current.startTime,
      persistedEndDate ?? end,
      persistedEndTime ?? formatLocalTime(end),
    );
    if (!interval) {
      return;
    }
    this.confirmedStops[index] = {
      ...this.cloneStop(current),
      finishCommandId,
      endDate: persistedEndDate ?? this.dateOnly(end),
      endTime: persistedEndTime ?? formatLocalTime(end),
      status: 'FINALIZADA',
      durationMinutes: durationMinutes(interval.start, interval.end),
    };
  }

  private captureFinish(current: StopEntry, idempotencyKey: string, end: Date) {
    return this.commands.capture({
      commandType: 'FINISH_STOP',
      aggregateId: current.localId ?? current.idempotencyKey,
      businessStatus: 'FINALIZADA',
      idempotencyKey,
      dependencyIds: [current.creationCommandId ?? current.idempotencyKey],
      occurredAt: end.toISOString(),
      payload: {
        stopLocalId: current.localId ?? current.idempotencyKey,
        endAt: end.toISOString(),
        endDate: formatLocalDate(end),
        endTime: formatLocalTime(end),
      },
    });
  }

  private parsePersistedLocalDate(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const local = parseLocalDate(value);
    if (local) return local;
    const legacy = new Date(value);
    return Number.isNaN(legacy.getTime()) ? null : this.dateOnly(legacy);
  }

  private isValidPersistedContext(value: unknown): value is ProductionContext {
    if (!value || typeof value !== 'object') return false;
    const context = value as Record<string, unknown>;
    const area = context['area'];
    const workCenter = context['workCenter'];
    if (!area || typeof area !== 'object' || !workCenter || typeof workCenter !== 'object') {
      return false;
    }
    const areaValue = area as Record<string, unknown>;
    const centerValue = workCenter as Record<string, unknown>;
    return nonEmptyString(areaValue['code'])
      && nonEmptyString(areaValue['description'])
      && nonEmptyString(centerValue['code'])
      && nonEmptyString(centerValue['areaCode'])
      && typeof centerValue['active'] === 'boolean';
  }

  private isValidPersistedReason(value: unknown): value is StopReason {
    if (!value || typeof value !== 'object') return false;
    const reason = value as Record<string, unknown>;
    return Number.isInteger(reason['id'])
      && nonEmptyString(reason['code'])
      && nonEmptyString(reason['description']);
  }

  private isValidPersistedResponsible(value: unknown): value is ResponsavelParada {
    if (!value || typeof value !== 'object') return false;
    const responsible = value as Record<string, unknown>;
    return (responsible['tipo'] === 'OPERADOR' || responsible['tipo'] === 'EQUIPE')
      && nonEmptyString(responsible['codigo'])
      && nonEmptyString(responsible['nome']);
  }

}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
