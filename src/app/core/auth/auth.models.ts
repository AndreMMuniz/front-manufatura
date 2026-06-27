export interface User {
  id: string;
  nome: string;
  login: string;
  permissoes: Array<string>;
}

export interface AuthSession {
  user: User;
  token: string;
  authenticatedAt: Date;
}
