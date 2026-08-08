export interface User {
  id: string;
  nome: string;
  login: string;
  permissoes: Array<string>;
}

export interface AuthSession {
  user: User;
  mode: 'ONLINE' | 'OFFLINE';
  token?: string;
  authenticatedAt: Date;
  lastValidatedAt: Date;
  expiresAt?: Date;
}

export interface SessionExpirationMetadata {
  /**
   * Expiração absoluta definida pelo contrato de autenticação/política de
   * segurança. Sem este valor, a sessão online não ganha continuidade.
   */
  expiresAt: string;
}

export type OfflineContinuityMetadata = SessionExpirationMetadata;
