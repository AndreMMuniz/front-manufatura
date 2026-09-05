import { OperadorDTO } from './operador.dto';
import { EquipeContexto } from '../models/equipe-contexto.model';

export interface EquipeResponseDTO {
  readonly codigo: string;
  readonly descricao: string;
  readonly turno: string;
  readonly operadores: ReadonlyArray<OperadorDTO>;
  readonly alertas?: ReadonlyArray<EquipeAlertaDTO>;
}

export interface EquipeAlertaDTO {
  readonly mensagem: string;
}

export interface SalvarEquipeRequestDTO {
  readonly codigoEquipe: string;
  readonly operadores: ReadonlyArray<string>;
}

export interface CriarEquipeRequest extends EquipeContexto {
  readonly operadores: ReadonlyArray<string>;
}

export interface AtualizarEquipeRequest {
  readonly codigo: string;
  readonly operadores: ReadonlyArray<string>;
}
