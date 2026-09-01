import { ImmediateDeliveryResult } from '../../../core/offline/models/immediate-delivery-result';

export enum EstadoBatelada {
  ContextoPendente = 'ContextoPendente',
  ConsultandoOrdens = 'ConsultandoOrdens',
  OrdensDisponiveis = 'OrdensDisponiveis',
  BateladaPreparada = 'BateladaPreparada',
  Iniciando = 'Iniciando',
  BateladaIniciada = 'BateladaIniciada',
  ReportandoParcial = 'ReportandoParcial',
  EmParada = 'EmParada',
  Encerrando = 'Encerrando',
  Encerrada = 'Encerrada',
}

export type EstadoAssincronoBatelada = 'ocioso' | 'carregando' | 'sucesso' | 'vazio' | 'erro';

export type { AreaProducao as AreaProducaoBatelada } from '../../shop-floor/models/production-area';

export interface OrdemLiberadaBatelada {
  readonly id: string;
  readonly ordem: string;
  readonly itemOp: string;
  readonly operacao: string;
  readonly split: string;
}

export type TipoResponsavelBatelada = 'OPERADOR' | 'EQUIPE';

export interface ResponsavelBatelada {
  readonly tipo: TipoResponsavelBatelada;
  readonly codigo: string;
  readonly nome: string;
}

export interface ContextoBatelada {
  readonly areaCode: string;
  readonly workCenterCode: string;
}

export interface InicioBatelada {
  readonly batchId: string;
  readonly iniciadoEm: Date;
  readonly ordensIniciadas: ReadonlyArray<string>;
  readonly startCommandId?: string;
  readonly delivery?: ImmediateDeliveryResult;
}

export type InicioBateladaEntregue = InicioBatelada & {
  readonly delivery: ImmediateDeliveryResult;
};

export interface MotivoRefugoBatelada {
  readonly motivoCode: string;
  readonly descricao: string;
  readonly quantidade: number;
}

export interface ItemReporteBatelada {
  readonly orderId: string;
  readonly ordem: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly refugoItens: ReadonlyArray<MotivoRefugoBatelada>;
}

export interface RascunhoReporteBatelada {
  readonly idempotencyKey: string | null;
  readonly items: ReadonlyArray<ItemReporteBatelada>;
  readonly finalizarSplit?: boolean;
}

export interface ReporteParcialBatelada {
  readonly reporteId: string;
  readonly batchId: string;
  readonly idempotencyKey: string;
  readonly confirmadoEm: Date;
  readonly items: ReadonlyArray<ItemReporteBatelada>;
}

export interface TotaisOrdemBatelada {
  readonly orderId: string;
  readonly ordem: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly quantidadeTotal: number;
}

export interface TotaisBatelada {
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly quantidadeTotal: number;
}

export interface EncerramentoBatelada {
  readonly batchId: string;
  readonly encerradoEm: Date;
  readonly ordensEncerradas: ReadonlyArray<string>;
}

export function arredondarQuantidadeBatelada(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
