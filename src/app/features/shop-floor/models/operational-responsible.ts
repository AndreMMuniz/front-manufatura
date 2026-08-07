export type TipoResponsavelOperacional = 'OPERADOR' | 'EQUIPE';

export interface ResponsavelOperacional {
  readonly tipo: TipoResponsavelOperacional;
  readonly codigo: string;
  readonly nome: string;
}
