export interface Usuario {
  id: string;
  nome: string;
  login: string;
  permissoes: Array<string>;
}

export interface LoginAutenticado {
  token: string;
  tokenExpiresAt: string;
  offlineSessionExpiresAt?: string;
  usuario: Usuario;
}
