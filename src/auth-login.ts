import { randomUUID } from 'node:crypto';

export interface AuthenticatedLogin {
  token: string;
  usuario: {
    id: string;
    nome: string;
    login: string;
    permissoes: string[];
  };
}

export type LoginEnvironment = Record<string, string | undefined>;

export interface LoginInput {
  login?: unknown;
  senha?: unknown;
}

function readConfig(env: LoginEnvironment) {
  return {
    user: env['APP_LOGIN_USER']?.trim() || 'operador',
    password: env['APP_LOGIN_PASSWORD']?.trim() || 'mock123',
    name: env['APP_LOGIN_NAME']?.trim() || 'Operador Cortag',
  };
}

function createSessionToken() {
  return `external-session-${randomUUID()}`;
}

export function authenticateExternalLogin(
  input: LoginInput,
  env: LoginEnvironment,
): AuthenticatedLogin | null {
  const login = typeof input.login === 'string' ? input.login.trim() : '';
  const senha = typeof input.senha === 'string' ? input.senha.trim() : '';
  const config = readConfig(env);

  if (!login || !senha || login !== config.user || senha !== config.password) {
    return null;
  }

  return {
    token: createSessionToken(),
    usuario: {
      id: 'USR-EXTERNAL',
      nome: config.name,
      login,
      permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
    },
  };
}
