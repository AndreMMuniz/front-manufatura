import {
  ContextoBatelada,
  OrdemLiberadaBatelada,
  ResponsavelBatelada,
} from '../models/reporta-batelada.model';

export interface ConsultaOrdensBateladaRequest {
  readonly areaCode: string;
  readonly workCenterCode: string;
}

export interface IniciarBateladaRequest {
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
  readonly iniciadoEm?: Date;
  readonly resultados: ReadonlyArray<ResultadoInicioOrdem>;
}
