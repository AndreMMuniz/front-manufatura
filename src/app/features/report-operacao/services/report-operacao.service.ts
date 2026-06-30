import { Injectable } from '@angular/core';

import { Observable, delay, map, of } from 'rxjs';

import {
  ConsultaOPRequest,
  IniciarOperacaoRequest,
  ReportOperacaoResponseDTO,
  ReportarOperacaoRequest,
} from '../interfaces/report-operacao.dto';
import { ReportOperacao, ReporteResultado, ResultadoConsultaOP } from '../models/report-operacao.model';

@Injectable({ providedIn: 'root' })
export class ReportOperacaoService {
  private readonly operacoes: ReadonlyArray<ReportOperacaoResponseDTO> = [
    {
      ordem: '450001',
      op: 'OP-10458',
      split: '01',
      item: 'CORT-1200',
      descricao: 'Riscador profissional para porcelanato',
      unidade: 'PC',
      roteiro: 'MONO-001',
      quantidadeOrdem: 500,
      quantidadeSaldo: 320,
      linha: 'Linha Montagem 02',
      ct: 'CT-ESTAMP-01',
      grupoMaquina: 'Prensas Hidraulicas',
      operador: 'Joao Pereira',
      equipe: 'Equipe A',
      turno: '1o Turno',
    },
    {
      ordem: '450002',
      op: 'OP-10459',
      split: '02',
      item: 'CORT-2200',
      descricao: 'Cortador manual linha obra',
      unidade: 'PC',
      roteiro: 'MONO-004',
      quantidadeOrdem: 250,
      quantidadeSaldo: 75,
      linha: 'Linha Montagem 04',
      ct: 'CT-MONT-04',
      grupoMaquina: 'Bancadas de Montagem',
      operador: 'Maria Santos',
      equipe: 'Equipe B',
      turno: '2o Turno',
    },
  ];

  consultarOP(request: ConsultaOPRequest): Observable<ResultadoConsultaOP> {
    return of(request).pipe(
      delay(250),
      map(({ ordem, op, split }) => {
        const operacao = this.operacoes.find(
          item =>
            this.normalize(item.ordem) === this.normalize(ordem) &&
            this.normalize(item.op) === this.normalize(op) &&
            (!split.trim() || this.normalize(item.split) === this.normalize(split)),
        );

        if (!operacao) {
          return {
            sucesso: false,
            mensagem: 'OP não encontrada ou não liberada para produção.',
          };
        }

        return {
          sucesso: true,
          operacao: this.mapOperacao(operacao),
        };
      }),
    );
  }

  iniciarOperacao(request: IniciarOperacaoRequest): Observable<{ readonly dataInicio: Date; readonly horaInicio: string }> {
    return of({ dataInicio: request.dataInicio, horaInicio: request.horaInicio }).pipe(delay(200));
  }

  reportarOperacao(request: ReportarOperacaoRequest): Observable<ReporteResultado> {
    return of({
      apontamentoId: `${request.op}-${Date.now()}`,
      reportadoEm: new Date(),
    }).pipe(delay(300));
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

  private dateOnly(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
}
