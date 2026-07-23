export enum EstadoBatelada {
  ContextoPendente = 'ContextoPendente',
  ConsultandoOrdens = 'ConsultandoOrdens',
  OrdensDisponiveis = 'OrdensDisponiveis',
  BateladaPreparada = 'BateladaPreparada',
  Iniciando = 'Iniciando',
  BateladaIniciada = 'BateladaIniciada',
}

export type EstadoAssincronoBatelada = 'ocioso' | 'carregando' | 'sucesso' | 'vazio' | 'erro';

export interface AreaProducaoBatelada {
  readonly code: string;
  readonly description: string;
}

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
  readonly iniciadoEm: Date;
  readonly ordensIniciadas: ReadonlyArray<string>;
}
