import { randomUUID } from 'node:crypto';

export interface AuthenticatedLogin {
  token: string;
  offlineSessionExpiresAt?: string;
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
  const offlineSessionTtlMs = Number(env['APP_OFFLINE_SESSION_TTL_MS']);
  return {
    user: env['APP_LOGIN_USER']?.trim() || 'operador',
    password: env['APP_LOGIN_PASSWORD']?.trim() || 'mock123',
    name: env['APP_LOGIN_NAME']?.trim() || 'Operador Cortag',
    offlineSessionTtlMs: Number.isFinite(offlineSessionTtlMs) && offlineSessionTtlMs > 0
      ? offlineSessionTtlMs
      : null,
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

  const offlineSessionExpiresAt = validOfflineSessionExpiresAt(config.offlineSessionTtlMs);

  return {
    token: createSessionToken(),
    ...(offlineSessionExpiresAt ? { offlineSessionExpiresAt } : {}),
    usuario: {
      id: 'USR-EXTERNAL',
      nome: config.name,
      login,
      permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
    },
  };
}

function validOfflineSessionExpiresAt(ttlMs: number | null): string | undefined {
  if (ttlMs === null) {
    return undefined;
  }

  const expiresAt = Date.now() + ttlMs;
  return Number.isFinite(expiresAt) && expiresAt <= 8.64e15
    ? new Date(expiresAt).toISOString()
    : undefined;
}
