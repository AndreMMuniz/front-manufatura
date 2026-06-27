import { OperadorDTO } from './operador.dto';

export interface EquipeResponseDTO {
  readonly codigo: string;
  readonly descricao: string;
  readonly turno: string;
  readonly operadores: ReadonlyArray<OperadorDTO>;
}

export interface SalvarEquipeRequestDTO {
  readonly codigoEquipe: string;
  readonly operadores: ReadonlyArray<string>;
}
