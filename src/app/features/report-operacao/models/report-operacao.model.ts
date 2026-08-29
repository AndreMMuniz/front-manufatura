import type { ImmediateDeliveryResult } from '../../../core/offline/models/immediate-delivery-result';

export enum EstadoOperacao {
  SemOP = 'SemOP',
  Carregando = 'Carregando',
  OPEncontrada = 'OPEncontrada',
  OperacaoIniciada = 'OperacaoIniciada',
  EmParada = 'EmParada',
  Reportando = 'Reportando',
  Reportada = 'Reportada',
  Erro = 'Erro',
}

export type { AreaProducao } from '../../shop-floor/models/production-area';

export interface OrdemCentroTrabalho {
  readonly id: string;
  readonly ordem: string;
  readonly itemOp: string;
  readonly operacao: string;
  readonly split: string;
  readonly indEstadoSplit?: number;
  readonly areaCode?: string;
  readonly workCenterCode?: string;
}

export type EstadoConsultaOrdens =
  | 'contexto-pendente'
  | 'carregando-areas'
  | 'pronto'
  | 'consultando-ordens'
  | 'ordens-disponiveis'
  | 'lista-vazia'
  | 'carregando-ordem'
  | 'erro';

export interface ReportOperacao {
  readonly startCommandId?: string;
  readonly indReporteMod?: number;
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
  readonly dataInicio?: Date;
  readonly horaInicio: string;
  readonly dataFim?: Date;
  readonly horaFim: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly ct: string;
  readonly grupoMaquina: string;
  readonly operador: string;
  readonly equipe: string;
  readonly turno: string;
}

export type TipoResponsavelOperacao = 'OPERADOR' | 'EQUIPE';

export interface ResponsavelOperacao {
  readonly tipo: TipoResponsavelOperacao;
  readonly codigo: string;
  readonly nome: string;
}

export interface ReporteRefugoItem {
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
}

export interface ReporteParcialOperacao {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly registradoEm: Date;
  readonly dataInicio: Date;
  readonly horaInicio: string;
  readonly dataFim: Date;
  readonly horaFim: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly refugoItens: ReadonlyArray<ReporteRefugoItem>;
  readonly commandId?: string;
  readonly deliveryStatus?: ImmediateDeliveryResult['status'];
  readonly supersedesLocalId?: string;
}

export interface ResultadoConsultaOP {
  readonly sucesso: boolean;
  readonly operacao?: ReportOperacao;
  readonly mensagem?: string;
}

export interface ReporteResultado {
  readonly apontamentoId: string;
  readonly reportadoEm: Date;
}

export interface ReporteOperacaoResultado extends ReporteResultado {
  readonly delivery: ImmediateDeliveryResult;
  readonly supersedesLocalId?: string;
}
