import {
  ContextoBatelada,
  OrdemLiberadaBatelada,
  ReporteParcialBatelada,
  ResponsavelBatelada,
} from '../models/reporta-batelada.model';

export interface ConsultaOrdensBateladaRequest {
  readonly areaCode: string;
  readonly workCenterCode: string;
}

export interface IniciarBateladaRequest {
  readonly batchId?: string;
  readonly idempotencyKey?: string;
  readonly occurredAt?: string;
  readonly dataInicio: string;
  readonly horaInicio: string;
  readonly contexto: ContextoBatelada;
  readonly responsavel: ResponsavelBatelada;
  readonly ordens: ReadonlyArray<OrdemLiberadaBatelada>;
}

export interface ResultadoInicioOrdem {
  readonly ordemId: string;
  readonly sucesso: boolean;
  readonly mensagem?: string;
}

export type StatusInicioBatelada = 'SUCESSO_INTEGRAL' | 'RESULTADO_PARCIAL' | 'FALHA';

export interface IniciarBateladaResponse {
  readonly status: StatusInicioBatelada;
  readonly batchId?: string;
  readonly iniciadoEm?: Date;
  readonly resultados: ReadonlyArray<ResultadoInicioOrdem>;
}

export interface RefugoItemBateladaRequest {
  readonly motivoCode: string;
  readonly descricao: string;
  readonly quantidade: number;
}

export interface ItemReporteParcialBateladaRequest {
  readonly orderId: string;
  readonly ordem: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly refugoItens: ReadonlyArray<RefugoItemBateladaRequest>;
}

export interface ReporteParcialBateladaRequest {
  readonly batchId: string;
  readonly idempotencyKey: string;
  readonly items: ReadonlyArray<ItemReporteParcialBateladaRequest>;
  readonly contexto: ContextoBatelada;
  readonly responsavel: ResponsavelBatelada;
  readonly dataInicio: Date;
  readonly horaInicio: string;
  readonly dataFim: Date;
  readonly horaFim: string;
  readonly finalizarSplit: boolean;
  readonly dependencyIds?: readonly string[];
}

export interface ResultadoComandoOrdem {
  readonly ordemId: string;
  readonly sucesso: boolean;
  readonly mensagem?: string;
}

export type StatusComandoBatelada = 'SUCESSO_INTEGRAL' | 'RESULTADO_PARCIAL' | 'FALHA';

export interface ReporteParcialBateladaResponse {
  readonly status: StatusComandoBatelada;
  readonly reporteId?: string;
  readonly batchId?: string;
  readonly idempotencyKey?: string;
  readonly confirmadoEm?: Date;
  readonly resultados: ReadonlyArray<ResultadoComandoOrdem>;
}

export interface ListarReportesBateladaResponse {
  readonly batchId: string;
  readonly reportes: ReadonlyArray<ReporteParcialBatelada>;
}

export interface EncerrarBateladaRequest {
  readonly batchId: string;
  readonly orderIds: ReadonlyArray<string>;
  readonly idempotencyKey?: string;
  readonly dependencyIds?: readonly string[];
}

export interface EncerrarBateladaResponse {
  readonly status: StatusComandoBatelada;
  readonly batchId?: string;
  readonly encerradoEm?: Date;
  readonly resultados: ReadonlyArray<ResultadoComandoOrdem>;
}
