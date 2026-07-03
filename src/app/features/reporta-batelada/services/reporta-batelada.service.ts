import { Injectable } from '@angular/core';

import { Observable, delay, of } from 'rxjs';

import { OperationalContext } from '../../shop-floor/models/operational-context';
import { ReportBatchRequest, StartBatchRequest } from '../interfaces/reporta-batelada.dto';
import {
  BatchReportResult,
  BatchReportState,
  BatchStartResult,
  EstadoBatelada,
} from '../models/reporta-batelada.model';

@Injectable({ providedIn: 'root' })
export class ReportaBateladaService {
  loadBatch(context: OperationalContext): Observable<BatchReportState> {
    return of({
      id: 'BAT-001',
      code: 'BAT-001',
      description: `Batelada ${context.workCenter.code}`,
      estado: EstadoBatelada.Carregada,
      horaInicio: '',
      horaFim: '',
      quantidadeRefugo: 0,
      quantidadeRetrabalho: 0,
      productionInfo: {
        ct: context.workCenter.code,
        gm: context.workCenter.machineGroup,
        operatorId: context.operator.code,
        operatorName: context.operator.name,
        teamName: 'Equipe A',
        shift: '1o Turno',
      },
      itens: [
        {
          opId: '367564',
          opNumber: '367564',
          orderNumber: '70455',
          productDescription: 'Chapa 3564',
          quantity: 0,
          selected: true,
        },
        {
          opId: '367565',
          opNumber: '367565',
          orderNumber: '70456',
          productDescription: 'Chapa 3565',
          quantity: 0,
          selected: true,
        },
        {
          opId: '367566',
          opNumber: '367566',
          orderNumber: '70457',
          productDescription: 'Chapa 3566',
          quantity: 0,
          selected: true,
        },
      ],
    }).pipe(delay(150));
  }

  startBatch(_request: StartBatchRequest): Observable<BatchStartResult> {
    const now = new Date();

    return of({
      dataInicio: now,
      horaInicio: this.formatTime(now),
    }).pipe(delay(150));
  }

  reportBatch(request: ReportBatchRequest): Observable<BatchReportResult> {
    return of({
      apontamentoId: `${request.batchId}-${Date.now()}`,
      reportadoEm: new Date(),
    }).pipe(delay(200));
  }

  validarInicio(state: BatchReportState): string {
    if (this.selectedItems(state).length === 0) {
      return 'Selecione ao menos uma OP da batelada.';
    }

    return '';
  }

  validarReporte(state: BatchReportState): string {
    const erroInicio = this.validarInicio(state);

    if (erroInicio) {
      return erroInicio;
    }

    if (!state.dataInicio || !state.horaInicio) {
      return 'Inicie a batelada antes de reportar.';
    }

    if (!state.dataFim || !state.horaFim) {
      return 'Informe data e hora fim para reportar.';
    }

    if (state.quantidadeRefugo < 0 || state.quantidadeRetrabalho < 0) {
      return 'As quantidades não podem ser negativas.';
    }

    if (this.selectedItems(state).some(item => item.quantity <= 0)) {
      return 'Informe quantidade maior que zero para todas as OPs selecionadas.';
    }

    if (this.combineDateAndTime(state.dataFim, state.horaFim).getTime() < this.combineDateAndTime(state.dataInicio, state.horaInicio).getTime()) {
      return 'Data e hora fim não podem ser anteriores ao início.';
    }

    return '';
  }

  toStartRequest(state: BatchReportState, now = new Date()): StartBatchRequest {
    return {
      batchId: state.id,
      itemIds: this.selectedItems(state).map(item => item.opId),
      dataInicio: now,
      horaInicio: this.formatTime(now),
      operatorId: state.productionInfo.operatorId,
      workCenter: state.productionInfo.ct,
    };
  }

  toReportRequest(state: BatchReportState): ReportBatchRequest {
    return {
      batchId: state.id,
      items: this.selectedItems(state).map(item => ({
        opId: item.opId,
        opNumber: item.opNumber,
        orderNumber: item.orderNumber,
        quantity: item.quantity,
      })),
      quantidadeRefugo: state.quantidadeRefugo,
      quantidadeRetrabalho: state.quantidadeRetrabalho,
      dataInicio: state.dataInicio ?? new Date(),
      horaInicio: state.horaInicio,
      dataFim: state.dataFim ?? new Date(),
      horaFim: state.horaFim,
      operatorId: state.productionInfo.operatorId,
      workCenter: state.productionInfo.ct,
    };
  }

  private selectedItems(state: BatchReportState) {
    return state.itens.filter(item => item.selected);
  }

  private combineDateAndTime(date: Date, time: string): Date {
    const [hours = '0', minutes = '0'] = time.split(':');

    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Number(hours), Number(minutes));
  }

  private formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}
