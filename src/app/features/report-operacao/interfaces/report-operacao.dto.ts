import { TipoResponsavelOperacao } from '../models/report-operacao.model';

export interface AreaProducaoResponseDTO {
  readonly code: string;
  readonly description: string;
}

export interface PesquisaCentroTrabalhoRequest {
  readonly areaCode: string;
  readonly term: string;
}

export interface ConsultaOrdensCentroRequest {
  readonly areaCode: string;
  readonly workCenterCode: string;
}

export type SituacaoOrdemDTO = 'LIBERADA' | 'NAO_LIBERADA';

export interface OrdemCentroTrabalhoResponseDTO {
  readonly id: string;
  readonly areaCode: string;
  readonly workCenterCode: string;
  readonly situacao: SituacaoOrdemDTO;
  readonly ordem: string;
  readonly itemOp: string;
  readonly operacao: string;
  readonly split: string;
  readonly operation: ReportOperacaoResponseDTO;
}

export interface ReportOperacaoResponseDTO {
  readonly ordem: string;
  readonly op: string;
  readonly split: string;
  readonly item: string;
  readonly descricao: string;
  readonly unidade: string;
  readonly roteiro: string;
  readonly quantidadeOrdem: number;
  readonly quantidadeSaldo: number;
  readonly linha: string;
  readonly ct: string;
  readonly grupoMaquina: string;
  readonly operador: string;
  readonly equipe: string;
  readonly turno: string;
}

export interface IniciarOperacaoRequest {
  readonly ordem: string;
  readonly op: string;
  readonly split: string;
  readonly operador: string;
  readonly equipe: string;
  readonly tipoResponsavel: TipoResponsavelOperacao;
  readonly codigoResponsavel: string;
  readonly dataInicio: Date;
  readonly horaInicio: string;
}

export interface EncerrarOperacaoRequest {
  readonly ordem: string;
  readonly op: string;
  readonly split: string;
  readonly dataFim: Date;
  readonly horaFim: string;
}

export interface RefugoItemRequest {
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
}

export interface ReportarOperacaoRequest {
  readonly ordem: string;
  readonly op: string;
  readonly split: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly refugoItens?: ReadonlyArray<RefugoItemRequest>;
  readonly dataInicio: Date;
  readonly horaInicio: string;
  readonly dataFim: Date;
  readonly horaFim: string;
  readonly operador: string;
  readonly equipe: string;
  readonly tipoResponsavel: TipoResponsavelOperacao;
  readonly codigoResponsavel: string;
  readonly ct: string;
}
