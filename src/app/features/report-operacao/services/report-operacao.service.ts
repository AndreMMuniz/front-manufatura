import { inject, Injectable } from '@angular/core';

import { Observable, delay, from, map, of } from 'rxjs';

import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';
import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import {
  EncerrarOperacaoRequest,
  IniciarOperacaoRequest,
  OrdemCentroTrabalhoResponseDTO,
  ReportOperacaoResponseDTO,
  ReportarOperacaoRequest,
} from '../interfaces/report-operacao.dto';
import {
  OrdemCentroTrabalho,
  ReportOperacao,
  ReporteResultado,
  ResponsavelOperacao,
  ResultadoConsultaOP,
} from '../models/report-operacao.model';

@Injectable({ providedIn: 'root' })
export class ReportOperacaoService {
  private readonly productionCatalog = inject(ProductionContextCatalogService);
  private readonly commands = inject(OperationalCommandFacade);

  private readonly ordens: ReadonlyArray<OrdemCentroTrabalhoResponseDTO> = [
    {
      id: '450001|OP-10458|10|01',
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      situacao: 'LIBERADA',
      ordem: '450001',
      itemOp: 'PERFIL-100 / OP-10458',
      operacao: '10',
      split: '01',
      operation: {
        ordem: '450001',
        op: 'OP-10458',
        split: '01',
        item: 'PERFIL-100',
        descricao: 'Perfil extrudado de alumínio',
        unidade: 'PC',
        roteiro: '10 - Extrusão',
        quantidadeOrdem: 500,
        quantidadeSaldo: 320,
        linha: 'Extrusao Linha 01',
        ct: 'CT-EXT-01',
        grupoMaquina: 'Extrusoras',
        operador: 'Ana Silva',
        equipe: 'Equipe A',
        turno: '1o Turno',
      },
    },
    {
      id: '450002|OP-10459|20|01',
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      situacao: 'LIBERADA',
      ordem: '450002',
      itemOp: 'PERFIL-200 / OP-10459',
      operacao: '20',
      split: '01',
      operation: {
        ordem: '450002',
        op: 'OP-10459',
        split: '01',
        item: 'PERFIL-200',
        descricao: 'Perfil extrudado reforçado',
        unidade: 'PC',
        roteiro: '20 - Acabamento',
        quantidadeOrdem: 250,
        quantidadeSaldo: 75,
        linha: 'Extrusao Linha 01',
        ct: 'CT-EXT-01',
        grupoMaquina: 'Extrusoras',
        operador: 'Ana Silva',
        equipe: 'Equipe A',
        turno: '1o Turno',
      },
    },
    {
      id: '450003|OP-10460|30|01',
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      situacao: 'NAO_LIBERADA',
      ordem: '450003',
      itemOp: 'PERFIL-300 / OP-10460',
      operacao: '30',
      split: '01',
      operation: {
        ordem: '450003',
        op: 'OP-10460',
        split: '01',
        item: 'PERFIL-300',
        descricao: 'Perfil ainda não liberado',
        unidade: 'PC',
        roteiro: '30 - Inspeção',
        quantidadeOrdem: 100,
        quantidadeSaldo: 100,
        linha: 'Extrusao Linha 01',
        ct: 'CT-EXT-01',
        grupoMaquina: 'Extrusoras',
        operador: 'Ana Silva',
        equipe: 'Equipe A',
        turno: '1o Turno',
      },
    },
  ];

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
      map(centers => {
        const validCenter = centers.some(center => this.normalize(center.code) === this.normalize(workCenterCode));
        if (!validCenter) {
          return [];
        }

        return this.ordens
          .filter(
            item =>
              item.situacao === 'LIBERADA' &&
              this.normalize(item.areaCode) === this.normalize(areaCode) &&
              this.normalize(item.workCenterCode) === this.normalize(workCenterCode),
          )
          .map(item => this.mapOrdem(item));
      }),
    );
  }

  carregarOrdemSelecionada(ordem: OrdemCentroTrabalho): Observable<ResultadoConsultaOP> {
    return of(ordem).pipe(
      delay(250),
      map(selected => {
        const found = this.ordens.find(item => item.id === selected.id && item.situacao === 'LIBERADA');

        if (!found) {
          return {
            sucesso: false,
            mensagem: 'OP não encontrada ou não liberada para produção.',
          };
        }

        return {
          sucesso: true,
          operacao: this.mapOperacao(found.operation),
        };
      }),
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
  ): Observable<ReadonlyArray<ResponsavelOperacao>> {
    return this.productionCatalog.listarResponsaveis(areaCode, workCenterCode).pipe(
      map(responsaveis => responsaveis.map(responsavel => ({ ...responsavel }))),
    );
  }

  reportarOperacao(request: ReportarOperacaoRequest): Observable<ReporteResultado> {
    const reportadoEm = new Date(this.combineDateTime(request.dataFim, request.horaFim));
    return from(this.commands.capture({
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
    })).pipe(map(confirmation => ({
      apontamentoId: confirmation.localId,
      reportadoEm,
    })));
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
        dataFim: request.dataFim.toISOString(),
        horaFim: request.horaFim,
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

  private mapOrdem(dto: OrdemCentroTrabalhoResponseDTO): OrdemCentroTrabalho {
    return {
      id: dto.id,
      ordem: dto.ordem,
      itemOp: dto.itemOp,
      operacao: dto.operacao,
      split: dto.split,
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
}
