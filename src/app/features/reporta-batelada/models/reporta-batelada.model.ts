export enum EstadoBatelada {
  Inicial = 'Inicial',
  Carregando = 'Carregando',
  Carregada = 'Carregada',
  ProducaoIniciada = 'ProducaoIniciada',
  EmParada = 'EmParada',
  Reportando = 'Reportando',
  Reportada = 'Reportada',
  Erro = 'Erro',
}

export interface BateladaItem {
  readonly opId: string;
  readonly opNumber: string;
  readonly orderNumber: string;
  readonly productDescription: string;
  readonly quantity: number;
  readonly selected: boolean;
}

export interface ProductionInformation {
  readonly ct: string;
  readonly gm: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly teamId?: string;
  readonly teamName?: string;
  readonly shift: string;
}

export interface BatchReportState {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly estado: EstadoBatelada;
  readonly dataInicio?: Date;
  readonly horaInicio: string;
  readonly dataFim?: Date;
  readonly horaFim: string;
  readonly quantidadeRefugo: number;
  readonly quantidadeRetrabalho: number;
  readonly productionInfo: ProductionInformation;
  readonly itens: ReadonlyArray<BateladaItem>;
}

export interface BatchStartResult {
  readonly dataInicio: Date;
  readonly horaInicio: string;
}

export interface BatchReportResult {
  readonly apontamentoId: string;
  readonly reportadoEm: Date;
}
