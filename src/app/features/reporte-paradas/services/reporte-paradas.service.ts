import { Injectable } from '@angular/core';

import { Observable, delay, of } from 'rxjs';

import { ReportOperacao } from '../../report-operacao/models/report-operacao.model';
import {
  OrdemLiberadaBatelada,
  ResponsavelBatelada,
} from '../../reporta-batelada/models/reporta-batelada.model';
import { WorkCenter } from '../../shop-floor/models/work-center';
import { CreateStopRequest } from '../interfaces/reporte-paradas.dto';
import { ProductionContext, StopEntry, StopReason, StopSaveResult } from '../models/reporte-paradas.model';

@Injectable({ providedIn: 'root' })
export class ReporteParadasService {
  private activeContext: ProductionContext | null = null;
  private nextStopId = 1;

  private readonly reasons: ReadonlyArray<StopReason> = [
    { id: 1, code: '01', description: 'Setup' },
    { id: 2, code: '02', description: 'Almoço' },
    { id: 5, code: '05', description: 'Reunião' },
    { id: 8, code: '08', description: 'Manutenção' },
    { id: 12, code: '12', description: 'Falta de material' },
    { id: 15, code: '15', description: 'Troca Turno' },
  ];

  setContextFromOperation(operacao: ReportOperacao): void {
    this.activeContext = {
      workCenter: operacao.ct,
      machineGroup: operacao.grupoMaquina,
      operatorName: operacao.operador,
      team: operacao.equipe,
      shift: operacao.turno,
      reportId: `${operacao.ordem}-${operacao.op}-${operacao.split}`,
      sourceRoute: '/operation-reporting',
    };
  }

  setContextFromStartedBatch(
    workCenter: WorkCenter,
    responsavel: ResponsavelBatelada,
    composition: ReadonlyArray<OrdemLiberadaBatelada>,
    batchId = `BAT-${composition.map(order => `${order.id.length}:${order.id}`).join('|')}`,
    shift = '',
  ): void {
    this.activeContext = {
      workCenter: workCenter.code,
      machineGroup: workCenter.machineGroup,
      operatorName: responsavel.tipo === 'OPERADOR' ? responsavel.nome : '',
      team: responsavel.tipo === 'EQUIPE' ? responsavel.nome : '',
      shift,
      reportId: batchId,
      sourceRoute: '/batch-reporting',
    };
  }

  getActiveContext(): ProductionContext | null {
    return this.activeContext;
  }

  listReasons(): Observable<ReadonlyArray<StopReason>> {
    return of(this.reasons).pipe(delay(150));
  }

  createStop(reason: StopReason, now = new Date()): StopEntry {
    const end = new Date(now.getTime() + 15 * 60 * 1000);

    return {
      id: this.nextStopId++,
      reason,
      startDate: now,
      startTime: this.formatTime(now),
      endDate: end,
      endTime: this.formatTime(end),
      programmed: false,
    };
  }

  calculateDurationMinutes(stop: StopEntry): number {
    const start = this.combineDateAndTime(stop.startDate, stop.startTime);
    const end = stop.endDate ? this.combineDateAndTime(stop.endDate, stop.endTime) : null;

    if (!start || !end) {
      return 0;
    }

    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  formatDuration(stop: StopEntry): string {
    const minutes = this.calculateDurationMinutes(stop);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}:00`;
  }

  validateStops(stops: ReadonlyArray<StopEntry>, context: ProductionContext | null): string {
    if (!context) {
      return 'Abra o reporte de paradas a partir de uma operação iniciada.';
    }

    if (stops.length === 0) {
      return 'Adicione ao menos um motivo de parada.';
    }

    for (const stop of stops) {
      if (!stop.reason) {
        return 'Informe o motivo da parada.';
      }

      if (!stop.startDate || !stop.startTime) {
        return `Informe início para ${stop.reason.description}.`;
      }

      if (!stop.endDate || !stop.endTime) {
        return `Informe fim para ${stop.reason.description}.`;
      }

      const start = this.combineDateAndTime(stop.startDate, stop.startTime);
      const end = this.combineDateAndTime(stop.endDate, stop.endTime);

      if (!start || !end) {
        return `Informe datas e horários válidos para ${stop.reason.description}.`;
      }

      if (end.getTime() < start.getTime()) {
        return `O fim da parada ${stop.reason.description} não pode ser anterior ao início.`;
      }

      if (start.getTime() > Date.now() || end.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        return 'A parada não pode ser registrada em data futura fora do período operacional.';
      }
    }

    return '';
  }

  saveStops(context: ProductionContext, stops: ReadonlyArray<StopEntry>): Observable<StopSaveResult> {
    const _payload: ReadonlyArray<CreateStopRequest> = stops.map(stop => ({
      reportId: context.reportId,
      reasonId: stop.reason.id,
      startDate: stop.startDate,
      startTime: stop.startTime,
      endDate: stop.endDate,
      endTime: stop.endTime,
      programmed: stop.programmed,
    }));

    return of({
      protocol: `PAR-${Date.now()}`,
      savedAt: new Date(),
    }).pipe(delay(300));
  }

  private combineDateAndTime(date: Date, time: string): Date | null {
    const match = /^(\d{2}):(\d{2})$/.exec(time);

    if (!match) {
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
