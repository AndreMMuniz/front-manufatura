import { createAppSessionToken } from './app-session-token';
import { AuthLoginError } from './auth-login-error';
import {
  authenticateAndAuthorizeDatasul,
  type DatasulAuthConfig,
  type HttpTransport,
} from './datasul-auth-client';

export { AuthLoginError } from './auth-login-error';

export interface AuthenticatedLogin {
  token: string;
  tokenExpiresAt: string;
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

export interface LoginDependencies {
  transport?: HttpTransport;
  now?: () => Date;
  timeoutSignal?: (timeoutMs: number) => AbortSignal;
  issueToken?: typeof createAppSessionToken;
}

interface AuthGatewayConfig extends DatasulAuthConfig {
  tokenSecret: string;
  tokenTtlMs: number;
  offlineSessionTtlMs: number | null;
}

const PLACEHOLDER_SECRET = /(replace|example|change.?me|placeholder|mock)/i;
const MAX_SAFE_TTL_MS = 2_147_483_647;

function configurationError(): never {
  throw new AuthLoginError(503, 'auth-gateway-not-configured');
}

function requiredPositiveInteger(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    return configurationError();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SAFE_TTL_MS) {
    return configurationError();
  }
  return parsed;
}

function offlineTtl(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return null;
  }
  if (!/^-?\d+$/.test(value)) {
    return configurationError();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_SAFE_TTL_MS) {
    return configurationError();
  }
  return parsed <= 0 ? null : parsed;
}

function readConfig(env: LoginEnvironment): AuthGatewayConfig {
  let url: URL;
  try {
    url = new URL(env['DATASUL_BASE_URL'] ?? '');
  } catch {
    return configurationError();
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== '') {
    return configurationError();
  }

  const tokenSecret = env['APP_AUTH_TOKEN_SECRET'];
  if (!tokenSecret
    || Buffer.byteLength(tokenSecret, 'utf8') < 32
    || PLACEHOLDER_SECRET.test(tokenSecret)) {
    return configurationError();
  }

  return {
    baseUrl: url.toString(),
    requestTimeoutMs: requiredPositiveInteger(env['DATASUL_REQUEST_TIMEOUT_MS']),
    tokenSecret,
    tokenTtlMs: requiredPositiveInteger(env['APP_AUTH_TOKEN_TTL_MS']),
    offlineSessionTtlMs: offlineTtl(env['APP_OFFLINE_SESSION_TTL_MS']),
  };
}

function readCredentials(input: LoginInput): { login: string; senha: string } {
  const login = typeof input.login === 'string' ? input.login.trim() : '';
  const senha = typeof input.senha === 'string' ? input.senha : '';
  if (!login
    || !senha
    || login.includes(':')
    || /[\u0000-\u001f\u007f]/u.test(login)) {
    throw new AuthLoginError(401, 'invalid-credentials');
  }
  return { login, senha };
}

export async function authenticateExternalLogin(
  input: LoginInput,
  env: LoginEnvironment,
  dependencies: LoginDependencies = {},
): Promise<AuthenticatedLogin> {
  const credentials = readCredentials(input);
  const config = readConfig(env);
  const now = dependencies.now?.() ?? new Date();
  const identity = await authenticateAndAuthorizeDatasul(
    credentials.login,
    credentials.senha,
    config,
    {
      transport: dependencies.transport ?? fetch,
      timeoutSignal: dependencies.timeoutSignal ?? (timeoutMs => AbortSignal.timeout(timeoutMs)),
    },
  );
  const issued = await (dependencies.issueToken ?? createAppSessionToken)({
    subject: identity.codUsuario,
    permissions: identity.permissoes,
    secret: config.tokenSecret,
    ttlMs: config.tokenTtlMs,
    now,
  });
  const offlineSessionExpiresAt = config.offlineSessionTtlMs === null
    ? undefined
    : new Date(Math.min(
      now.getTime() + config.offlineSessionTtlMs,
      Date.parse(issued.tokenExpiresAt),
    )).toISOString();

  return {
    token: issued.token,
    tokenExpiresAt: issued.tokenExpiresAt,
    ...(offlineSessionExpiresAt ? { offlineSessionExpiresAt } : {}),
    usuario: {
      id: identity.codUsuario,
      login: identity.codUsuario,
      nome: identity.nomUsuario,
      permissoes: [...identity.permissoes],
    },
  };
}
