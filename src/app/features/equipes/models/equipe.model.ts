import { Operador } from './operador.model';

export interface Equipe {
  readonly codigo: string;
  readonly descricao: string;
  readonly turno: string;
  readonly operadores: ReadonlyArray<Operador>;
}
