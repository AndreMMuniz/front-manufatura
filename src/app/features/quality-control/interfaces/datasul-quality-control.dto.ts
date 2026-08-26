export interface DatasulEnvelope<T> {
  readonly total: number;
  readonly hasNext: boolean;
  readonly items: readonly T[];
}

export interface DatasulOrderItem {
  readonly 'ds-ordem-producao': {
    readonly ordem: readonly DatasulProductionOrder[];
  };
}

export interface DatasulProductionOrder {
  readonly nrOrdemProducao: number;
  readonly codItem: string;
  readonly descricaoItem?: string;
  readonly historicoRoteiros?: readonly DatasulRouteHistoryItem[];
  readonly operacoes: readonly DatasulOperation[];
}

export interface DatasulRouteHistoryItem {
  readonly nrFicha: number;
  readonly data: string | null;
  readonly hora: string;
  readonly nrOrdemProducao: number;
  readonly codOperacao: number;
}

export interface DatasulOperation {
  readonly codOperacao: number;
  readonly descricaoOperacao: string;
  readonly codItem: string;
  readonly centroTrabalho: string;
  readonly codGrupoMaquina: string;
  readonly splits: readonly DatasulSplit[];
}

export interface DatasulSplit {
  readonly numSplit: number;
  readonly codItemFabricado: string;
  readonly centroTrabalho: string;
  readonly codGrupoMaquina: string;
}

export interface DatasulRouteItem {
  readonly nrFicha: number;
  readonly tipoResponsavel?: 'OPERADOR' | 'EQUIPE';
  readonly codResponsavel?: string;
  readonly 'ds-roteiro': { readonly exames: readonly DatasulExam[] };
}

export interface DatasulExam {
  readonly codExame: number;
  readonly descricao: string;
  readonly versao: number;
  readonly frequencia: number;
  readonly amostra: number;
  readonly nivel: number;
  readonly nqa: number;
  readonly responsavel: string;
  readonly observacao: string;
  readonly componentes: readonly DatasulComponent[];
}

export interface DatasulResultOption {
  readonly nrTabela: number;
  readonly seqOpcao: number;
  readonly codComponente: number;
  readonly codExame: number;
  readonly descricao: string;
}

export interface DatasulComponent {
  readonly codExame: number;
  readonly codComponente: number;
  readonly descricao: string;
  readonly referenciaTecnica: string;
  readonly metodo: string;
  readonly equipamento: string;
  readonly tipoResultado: number;
  readonly unidade: string;
  readonly numeroDecimais: number;
  readonly resultadoMin: number;
  readonly resultadoMax: number;
  readonly nrTabela: number;
  readonly opcoesResultado?: readonly DatasulResultOption[];
}

export interface DatasulResultReceipt {
  readonly nrFicha: number;
  readonly codExame: number;
  readonly codComponente: number;
  readonly resultado: number;
  readonly dentroFaixa: boolean;
  readonly componentesSalvos: number;
  readonly componentesTotal: number;
  readonly dtResultado: string;
}

export interface DatasulFinalizeItem {
  readonly 'ds-finaliza': {
    readonly roteiro: readonly DatasulFinalizeReceipt[];
  };
}

export interface DatasulFinalizeReceipt {
  readonly nrFicha: number;
  readonly finalizado: boolean;
  readonly inspecionado: boolean;
  readonly componentesTotal: number;
  readonly componentesSalvos: number;
  readonly componentesPendentes: number;
  readonly mensagem: string;
}
