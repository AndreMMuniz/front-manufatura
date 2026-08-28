import { inject, Injectable } from '@angular/core';

import { Observable, delay, from, map, of, switchMap } from 'rxjs';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { ImmediateCommandDeliveryService } from '../../../core/offline/services/immediate-command-delivery.service';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { LocalRecordRepository } from '../../../core/offline/repositories/local-record.repository';
import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';
import { EquipeResponseDTO } from '../../equipes/interfaces/equipe.dto';
import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import {
  EncerrarOperacaoRequest,
  IniciarOperacaoRequest,
  ReportOperacaoResponseDTO,
  ReportarOperacaoRequest,
} from '../interfaces/report-operacao.dto';
import {
  OrdemCentroTrabalho,
  ReportOperacao,
  ReporteOperacaoResultado,
  ReporteResultado,
  ReporteParcialOperacao,
  ResponsavelOperacao,
  ResultadoConsultaOP,
  TipoResponsavelOperacao,
} from '../models/report-operacao.model';

@Injectable({ providedIn: 'root' })
export class ReportOperacaoService {
  private readonly productionCatalog = inject(ProductionContextCatalogService);
  private readonly commands = inject(OperationalCommandFacade);
  private readonly immediateDelivery = inject(ImmediateCommandDeliveryService);
  private readonly authSession = inject(AuthSessionService);
  private readonly localRecords = inject(LocalRecordRepository);
  private readonly api = inject(AuthenticatedApiService);

  listarAreasProducao(): Observable<ReadonlyArray<AreaProducao>> {
    return this.productionCatalog.listarAreas().pipe(delay(100));
  }

  pesquisarCentrosTrabalho(areaCode: string, termo: string): Observable<ReadonlyArray<WorkCenter>> {
    return this.productionCatalog.pesquisarCentros(areaCode, termo);
  }

  listarOrdensPorCentro(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<OrdemCentroTrabalho>> {
    return this.productionCatalog.pesquisarCentros(areaCode, '').pipe(
      delay(150),
      switchMap(centers => {
        const validCenter = centers.some(center => this.normalize(center.code) === this.normalize(workCenterCode));
        if (!validCenter) {
          return of([] as ReadonlyArray<OrdemCentroTrabalho>);
        }
        return this.api.get<ReadonlyArray<OrdemCentroTrabalho>>('/api/production-orders', {
          areaCode: areaCode.trim(),
          workCenterCode: workCenterCode.trim(),
          status: 'RELEASED',
        });
      }),
      map(orders => orders.map(order => ({ ...order }))),
    );
  }

  carregarOrdemSelecionada(ordem: OrdemCentroTrabalho): Observable<ResultadoConsultaOP> {
    return this.api.get<ReportOperacaoResponseDTO>(
      `/api/production-orders/${encodeURIComponent(ordem.ordem)}/operations/${encodeURIComponent(ordem.operacao)}`,
      {
        split: ordem.split,
        areaCode: ordem.areaCode,
        workCenterCode: ordem.workCenterCode,
      },
    ).pipe(
      map(operation => ({ sucesso: true, operacao: this.mapOperacao(operation) })),
    );
  }

  iniciarOperacao(request: IniciarOperacaoRequest): Observable<{
    readonly dataInicio: Date;
    readonly horaInicio: string;
    readonly idempotencyKey: string;
  }> {
    const aggregateId = this.operationAggregateId(request.ordem, request.op, request.split);
    return from(this.commands.capture({
      commandType: 'START_OPERATION',
      aggregateId,
      businessStatus: 'INICIADA',
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      occurredAt: this.combineDateTime(request.dataInicio, request.horaInicio),
      payload: {
        ordem: request.ordem,
        op: request.op,
        split: request.split,
        areaCode: request.areaCode,
        workCenterCode: request.workCenterCode,
        area: { ...request.area },
        workCenter: { ...request.workCenter },
        operation: this.operationSnapshot(request.operationSnapshot),
        operador: request.operador,
        equipe: request.equipe,
        tipoResponsavel: request.tipoResponsavel,
        codigoResponsavel: request.codigoResponsavel,
        dataInicio: request.dataInicio.toISOString(),
        horaInicio: request.horaInicio,
      },
    })).pipe(map(confirmation => ({
      dataInicio: request.dataInicio,
      horaInicio: request.horaInicio,
      idempotencyKey: confirmation.idempotencyKey,
    })));
  }

  listarResponsaveis(
    areaCode: string,
    workCenterCode: string,
    tipo?: TipoResponsavelOperacao,
  ): Observable<ReadonlyArray<ResponsavelOperacao>> {
    const area = this.normalizeCode(areaCode);
    const center = this.normalizeCode(workCenterCode);
    if (!area || !center) return of([]);

    if (tipo === 'EQUIPE') {
      return this.api.get<ReadonlyArray<EquipeResponseDTO>>('/api/teams', {
        areaCode: area,
        workCenterCode: center,
      }).pipe(map(equipes => equipes.map(equipe => ({
        tipo: 'EQUIPE' as const,
        codigo: equipe.codigo,
        nome: equipe.descricao,
      }))));
    }

    return this.productionCatalog.listarResponsaveis(area, center).pipe(
      map(responsaveis => responsaveis
        .filter(responsavel => tipo !== 'OPERADOR' || responsavel.tipo === 'OPERADOR')
        .map(responsavel => ({ ...responsavel }))),
    );
  }

  restaurarOperacaoAtiva(): Observable<{
    readonly area: AreaProducao;
    readonly workCenter: WorkCenter;
    readonly operation: ReportOperacao;
    readonly responsavel: ResponsavelOperacao;
    readonly reportes: ReadonlyArray<ReporteParcialOperacao>;
  } | null> {
    const ownerId = this.authSession.currentUser?.id.trim();
    if (!ownerId) return of(null);
    return from(this.localRecords.listByOwner(ownerId)).pipe(map(records => {
      const starts = [...records]
        .filter(record => record.commandType === 'START_OPERATION')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const start = starts.find(candidate =>
        !records.some(record => record.aggregateId === candidate.aggregateId && (
          record.commandType === 'END_OPERATION'
          || (record.commandType === 'REPORT_OPERATION'
            && (record.payload as Record<string, unknown>)['finalizarSplit'] === true)
        )));
      if (!start) return null;
      const payload = start.payload as Record<string, unknown>;
      const area = payload['area'] as AreaProducao | undefined;
      const workCenter = payload['workCenter'] as WorkCenter | undefined;
      const operation = this.restoreOperationSnapshot(
        payload['operation'],
        start.idempotencyKey,
        start.occurredAt,
      );
      const responsibleType = payload['tipoResponsavel'];
      const responsibleCode = payload['codigoResponsavel'];
      const responsibleName =
        responsibleType === 'OPERADOR' ? payload['operador'] : payload['equipe'];
      if (
        !area?.code
        || !workCenter?.code
        || !operation
        || (responsibleType !== 'OPERADOR' && responsibleType !== 'EQUIPE')
        || typeof responsibleCode !== 'string'
        || typeof responsibleName !== 'string'
      ) {
        return null;
      }
      const reportes = records
        .filter(record =>
          record.commandType === 'REPORT_OPERATION'
          && record.aggregateId === start.aggregateId)
        .flatMap(record => this.restoreOperationReport(record.payload, record));
      return {
        area: { ...area },
        workCenter: { ...workCenter },
        operation,
        responsavel: {
          tipo: responsibleType,
          codigo: responsibleCode,
          nome: responsibleName,
        },
        reportes,
      };
    }));
  }

  reportarOperacao(request: ReportarOperacaoRequest): Observable<ReporteOperacaoResultado> {
    const reportadoEm = new Date(this.combineDateTime(request.dataFim, request.horaFim));
    const command = {
      commandType: 'REPORT_OPERATION',
      aggregateId: this.operationAggregateId(request.ordem, request.op, request.split),
      businessStatus: 'REPORTADA',
      idempotencyKey: request.idempotencyKey,
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      occurredAt: reportadoEm.toISOString(),
      payload: {
        ordem: request.ordem,
        op: request.op,
        split: request.split,
        areaCode: request.areaCode,
        finalizarSplit: request.finalizarSplit,
        quantidadeAprovada: request.quantidadeAprovada,
        quantidadeRetrabalho: request.quantidadeRetrabalho,
        quantidadeRefugo: request.quantidadeRefugo,
        refugoItens: (request.refugoItens ?? []).map(item => ({ ...item })),
        dataInicio: request.dataInicio.toISOString(),
        horaInicio: request.horaInicio,
        dataFim: request.dataFim.toISOString(),
        horaFim: request.horaFim,
        operador: request.operador,
        equipe: request.equipe,
        tipoResponsavel: request.tipoResponsavel,
        codigoResponsavel: request.codigoResponsavel,
        ct: request.ct,
      },
    } as const;
    return from(this.commands.capture(command)).pipe(
      switchMap(confirmation => from(
        this.immediateDelivery.deliver(confirmation.localId),
      ).pipe(map(delivery => ({
        apontamentoId: confirmation.localId,
        reportadoEm,
        delivery,
      })))),
    );
  }

  encerrarOperacao(request: EncerrarOperacaoRequest): Observable<ReporteResultado> {
    const reportadoEm = new Date(this.combineDateTime(request.dataFim, request.horaFim));
    return from(this.commands.capture({
      commandType: 'END_OPERATION',
      aggregateId: this.operationAggregateId(request.ordem, request.op, request.split),
      businessStatus: 'FINALIZADA',
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.dependencyIds ? { dependencyIds: request.dependencyIds } : {}),
      occurredAt: reportadoEm.toISOString(),
      payload: {
        ordem: request.ordem,
        op: request.op,
        split: request.split,
        areaCode: request.areaCode,
        ct: request.ct,
      },
    })).pipe(map(confirmation => ({
      apontamentoId: confirmation.localId,
      reportadoEm,
    })));
  }

  validarReporteParcial(
    operacao: ReportOperacao,
    quantidadeAprovada: number,
    quantidadeRetrabalho: number,
    quantidadeRefugo: number,
  ): string {
    const parcial = quantidadeAprovada + quantidadeRetrabalho + quantidadeRefugo;
    const acumulado =
      operacao.quantidadeAprovada + operacao.quantidadeRetrabalho + operacao.quantidadeRefugo;

    if (
      [quantidadeAprovada, quantidadeRetrabalho, quantidadeRefugo]
        .some(quantidade => !Number.isFinite(quantidade) || quantidade < 0)
    ) {
      return 'As quantidades não podem ser negativas.';
    }

    if (parcial <= 0) {
      return 'Informe ao menos uma quantidade produzida.';
    }

    if (this.round3(acumulado + parcial) > this.round3(operacao.quantidadeSaldo)) {
      return 'A quantidade acumulada não pode ultrapassar o saldo da OP.';
    }

    return '';
  }

  validarReporte(operacao: ReportOperacao): string {
    if (!operacao.dataInicio || !operacao.horaInicio) {
      return 'Inicie a operação antes de reportar.';
    }

    if (
      operacao.quantidadeAprovada < 0 ||
      operacao.quantidadeRetrabalho < 0 ||
      operacao.quantidadeRefugo < 0
    ) {
      return 'As quantidades não podem ser negativas.';
    }

    const quantidadeTotal =
      operacao.quantidadeAprovada + operacao.quantidadeRetrabalho + operacao.quantidadeRefugo;

    if (quantidadeTotal <= 0) {
      return 'Informe ao menos uma quantidade produzida.';
    }

    if (quantidadeTotal > operacao.quantidadeSaldo) {
      return 'A quantidade produzida não pode ultrapassar o saldo da OP.';
    }

    if (operacao.dataFim && operacao.dataInicio && this.dateOnly(operacao.dataFim) < this.dateOnly(operacao.dataInicio)) {
      return 'A data fim não pode ser anterior à data início.';
    }

    if (
      operacao.dataFim &&
      operacao.dataInicio &&
      this.dateOnly(operacao.dataFim).getTime() === this.dateOnly(operacao.dataInicio).getTime() &&
      operacao.horaFim &&
      operacao.horaInicio &&
      operacao.horaFim < operacao.horaInicio
    ) {
      return 'A hora fim não pode ser anterior à hora início.';
    }

    return '';
  }

  private mapOperacao(dto: ReportOperacaoResponseDTO): ReportOperacao {
    return {
      ...dto,
      horaInicio: '',
      horaFim: '',
      quantidadeAprovada: 0,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
    };
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private dateOnly(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private round3(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private operationAggregateId(ordem: string, op: string, split: string): string {
    return [ordem, op, split].map(value => this.normalizeCode(value)).join('|');
  }

  private combineDateTime(date: Date, time: string): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error('A data informada é inválida.');
    }
    const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
    if (!match) {
      throw new Error('A hora informada deve estar no formato HH:mm.');
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      throw new Error('A hora informada está fora da faixa válida.');
    }
    const occurredAt = new Date(date);
    occurredAt.setHours(hours, minutes, 0, 0);
    return occurredAt.toISOString();
  }

  private operationSnapshot(operation: ReportOperacao) {
    return {
      ...operation,
      dataInicio: operation.dataInicio?.toISOString() ?? null,
      dataFim: operation.dataFim?.toISOString() ?? null,
    };
  }

  private restoreOperationSnapshot(
    value: unknown,
    startCommandId: string,
    occurredAt: string,
  ): ReportOperacao | null {
    if (!value || typeof value !== 'object') return null;
    const operation = value as Record<string, unknown>;
    const requiredStrings = [
      'ordem', 'op', 'split', 'item', 'descricao', 'unidade', 'roteiro',
      'linha', 'ct', 'grupoMaquina', 'operador', 'equipe', 'turno',
    ];
    if (requiredStrings.some(key => typeof operation[key] !== 'string')) return null;
    const requiredNumbers = [
      'quantidadeOrdem', 'quantidadeSaldo', 'quantidadeAprovada',
      'quantidadeRetrabalho', 'quantidadeRefugo',
    ];
    if (requiredNumbers.some(key => typeof operation[key] !== 'number')) return null;
    return {
      ...(operation as unknown as ReportOperacao),
      startCommandId,
      dataInicio: new Date(occurredAt),
      horaInicio: typeof operation['horaInicio'] === 'string' ? operation['horaInicio'] : '',
      dataFim: undefined,
      horaFim: '',
    };
  }

  private restoreOperationReport(
    payload: unknown,
    record: { readonly localId: string; readonly idempotencyKey: string; readonly createdAt: string },
  ): readonly ReporteParcialOperacao[] {
    if (!payload || typeof payload !== 'object') return [];
    const value = payload as Record<string, unknown>;
    if (
      typeof value['quantidadeAprovada'] !== 'number'
      || typeof value['quantidadeRetrabalho'] !== 'number'
      || typeof value['quantidadeRefugo'] !== 'number'
      || typeof value['dataInicio'] !== 'string'
      || typeof value['dataFim'] !== 'string'
    ) return [];
    return [{
      id: record.localId,
      commandId: record.idempotencyKey,
      idempotencyKey: record.idempotencyKey,
      registradoEm: new Date(record.createdAt),
      dataInicio: new Date(value['dataInicio']),
      horaInicio: typeof value['horaInicio'] === 'string' ? value['horaInicio'] : '',
      dataFim: new Date(value['dataFim']),
      horaFim: typeof value['horaFim'] === 'string' ? value['horaFim'] : '',
      quantidadeAprovada: value['quantidadeAprovada'],
      quantidadeRetrabalho: value['quantidadeRetrabalho'],
      quantidadeRefugo: value['quantidadeRefugo'],
      refugoItens: Array.isArray(value['refugoItens'])
        ? value['refugoItens'] as ReporteParcialOperacao['refugoItens']
        : [],
    }];
  }
}
