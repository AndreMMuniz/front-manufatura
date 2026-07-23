import { inject, Injectable } from '@angular/core';

import { Observable, delay, map, of } from 'rxjs';

import { WorkCenter } from '../../shop-floor/models/work-center';
import { WorkCenterService } from '../../shop-floor/services/work-center';
import {
  AreaProducaoResponseDTO,
  EncerrarOperacaoRequest,
  IniciarOperacaoRequest,
  OrdemCentroTrabalhoResponseDTO,
  RefugoItemRequest,
  ReportOperacaoResponseDTO,
  ReportarOperacaoRequest,
} from '../interfaces/report-operacao.dto';
import {
  AreaProducao,
  OrdemCentroTrabalho,
  ReportOperacao,
  ReporteResultado,
  ResponsavelOperacao,
  ResultadoConsultaOP,
} from '../models/report-operacao.model';

@Injectable({ providedIn: 'root' })
export class ReportOperacaoService {
  private readonly workCenterService = inject(WorkCenterService);
  private readonly reportesPorIdempotencia = new Map<string, ReporteResultado>();

  private readonly areas: ReadonlyArray<AreaProducaoResponseDTO> = [
    { code: '4001', description: 'Produção' },
    { code: '4002', description: 'Qualidade' },
  ];

  private readonly responsaveis: ReadonlyArray<ResponsavelOperacao> = [
    { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
    { tipo: 'OPERADOR', codigo: '001', nome: 'Jose Ribeiro Neto' },
    { tipo: 'OPERADOR', codigo: '002', nome: 'Almir Rogerio Bento' },
    { tipo: 'OPERADOR', codigo: '003', nome: 'Carlos Silva' },
    { tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' },
    { tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Montagem Zap' },
    { tipo: 'EQUIPE', codigo: 'CORTE01', nome: 'Corte Industrial' },
    { tipo: 'EQUIPE', codigo: 'EMB02', nome: 'Embalagem' },
  ];

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
    return of(this.areas.map(area => this.mapArea(area))).pipe(delay(100));
  }

  pesquisarCentrosTrabalho(areaCode: string, termo: string): Observable<ReadonlyArray<WorkCenter>> {
    if (!this.areas.some(area => area.code === areaCode.trim())) {
      return of([]);
    }

    return this.workCenterService.searchActiveWorkCenters(areaCode, termo);
  }

  listarOrdensPorCentro(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<OrdemCentroTrabalho>> {
    return this.workCenterService.searchActiveWorkCenters(areaCode, '').pipe(
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

  iniciarOperacao(request: IniciarOperacaoRequest): Observable<{ readonly dataInicio: Date; readonly horaInicio: string }> {
    return of({ dataInicio: request.dataInicio, horaInicio: request.horaInicio }).pipe(delay(200));
  }

  listarResponsaveis(
    areaCode: string,
    workCenterCode: string,
  ): Observable<ReadonlyArray<ResponsavelOperacao>> {
    if (this.normalize(areaCode) !== '4001' || this.normalize(workCenterCode) !== 'ct-ext-01') {
      return of([]).pipe(delay(100));
    }

    return of(this.responsaveis.map(responsavel => ({ ...responsavel }))).pipe(delay(100));
  }

  reportarOperacao(request: ReportarOperacaoRequest): Observable<ReporteResultado> {
    const existing = this.reportesPorIdempotencia.get(request.idempotencyKey);
    if (existing) {
      return of({ ...existing, reportadoEm: new Date(existing.reportadoEm) }).pipe(delay(300));
    }

    const result = {
      apontamentoId: `${request.op}-${Date.now()}`,
      reportadoEm: new Date(),
    };
    this.reportesPorIdempotencia.set(request.idempotencyKey, result);
    return of({ ...result, reportadoEm: new Date(result.reportadoEm) }).pipe(delay(300));
  }

  encerrarOperacao(request: EncerrarOperacaoRequest): Observable<ReporteResultado> {
    return of({
      apontamentoId: `${request.op}-ENC-${Date.now()}`,
      reportadoEm: new Date(),
    }).pipe(delay(300));
  }

  validarReporteParcial(
    operacao: ReportOperacao,
    quantidadeAprovada: number,
    quantidadeRetrabalho: number,
    quantidadeRefugo: number,
    refugoItens: ReadonlyArray<RefugoItemRequest> = [],
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

    const totalMotivosRefugo = this.round3(
      refugoItens.reduce((total, item) => total + item.quantidade, 0),
    );
    if (
      refugoItens.some(item => !Number.isFinite(item.quantidade) || item.quantidade <= 0)
      || (this.round3(quantidadeRefugo) === 0 && refugoItens.length > 0)
      || (this.round3(quantidadeRefugo) > 0
        && (refugoItens.length === 0 || totalMotivosRefugo !== this.round3(quantidadeRefugo)))
    ) {
      return 'Os motivos de refugo devem totalizar a quantidade de refugo do reporte.';
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

  private mapArea(dto: AreaProducaoResponseDTO): AreaProducao {
    return { code: dto.code, description: dto.description };
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

  private dateOnly(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private round3(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }
}
