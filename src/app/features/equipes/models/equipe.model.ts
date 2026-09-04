import { Operador } from './operador.model';

export interface Equipe {
  readonly codigo: string;
  readonly descricao: string;
  readonly turno: string;
  readonly operadores: ReadonlyArray<Operador>;
  readonly alertas?: ReadonlyArray<EquipeAlerta>;
}

export interface EquipeAlerta {
  readonly mensagem: string;
}
