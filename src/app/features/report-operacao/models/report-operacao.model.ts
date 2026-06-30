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

export interface ReportOperacao {
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

export interface ResultadoConsultaOP {
  readonly sucesso: boolean;
  readonly operacao?: ReportOperacao;
  readonly mensagem?: string;
}

export interface ReporteResultado {
  readonly apontamentoId: string;
  readonly reportadoEm: Date;
}
