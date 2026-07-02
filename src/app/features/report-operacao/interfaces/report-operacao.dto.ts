export interface ConsultaOPRequest {
  readonly ordem: string;
  readonly op: string;
  readonly split: string;
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
  readonly dataInicio: Date;
  readonly horaInicio: string;
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
  readonly ct: string;
}
