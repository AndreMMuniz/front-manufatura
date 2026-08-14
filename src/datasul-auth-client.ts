import { AuthLoginError } from './auth-login-error';
import {
  APP_PERMISSIONS,
  DATASUL_SECURITY_PROGRAMS,
  type AppPermission,
  type DatasulSecurityProgram,
} from './app-permissions';
import { noopLogger, type ApplicationLogger } from './logging/log-contracts';
import {
  observeUpstreamFetch,
  reportUpstreamRequestCompleted,
  reportUpstreamResponseFailure,
  type UpstreamRequestDetails,
} from './server-upstream-observability';

export type HttpTransport = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DatasulAuthConfig {
  baseUrl: string;
  requestTimeoutMs: number;
}

export interface DatasulIdentity {
  codUsuario: string;
  nomUsuario: string;
  permissoes: AppPermission[];
}

export interface DatasulAuthClientDependencies {
  transport: HttpTransport;
  timeoutSignal: (timeoutMs: number) => AbortSignal;
  logger?: ApplicationLogger;
  clock?: () => number;
}

interface DatasulProgramAccess {
  readonly allowed: boolean;
  readonly userName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateEnvelope(value: unknown): unknown[] {
  if (!isRecord(value)
    || !Array.isArray(value['items'])
    || typeof value['hasNext'] !== 'boolean'
    || typeof value['total'] !== 'number'
    || !Number.isSafeInteger(value['total'])
    || value['total'] < 0) {
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }

  return value['items'];
}

function basicAuthorization(login: string, senha: string): string {
  return `Basic ${Buffer.from(`${login}:${senha}`, 'utf8').toString('base64')}`;
}

function mapRequestFailure(error: unknown, signal: AbortSignal): never {
  if (signal.aborted
    || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
    throw new AuthLoginError(504, 'datasul-timeout');
  }
  throw new AuthLoginError(502, 'datasul-unavailable');
}

async function getJson<T>(
  url: string,
  authorization: string,
  config: DatasulAuthConfig,
  dependencies: DatasulAuthClientDependencies,
  operation: string,
  route: string,
  parse: (value: unknown) => T,
): Promise<T> {
  const signal = dependencies.timeoutSignal(config.requestTimeoutMs);
  const destination = new URL(config.baseUrl);
  const observation: UpstreamRequestDetails = {
    system: 'datasul', operation, method: 'GET', route,
    protocol: destination.protocol as 'http:' | 'https:',
    destinationHost: destination.host,
  };
  let response: Response;
  try {
    response = await observeUpstreamFetch(
      dependencies.logger ?? noopLogger,
      observation,
      () => dependencies.transport(url, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: authorization, Accept: 'application/json' },
        signal,
      }),
      dependencies.clock,
    );
  } catch (error) {
    return mapRequestFailure(error, signal);
  }

  if (response.status === 401) {
    throw new AuthLoginError(401, 'invalid-credentials');
  }
  if (!response.ok) {
    throw new AuthLoginError(502, 'datasul-unavailable');
  }
  try {
    const parsed = parse(await response.json());
    reportUpstreamRequestCompleted(dependencies.logger ?? noopLogger, observation, response);
    return parsed;
  } catch (error) {
    reportUpstreamResponseFailure(dependencies.logger ?? noopLogger, observation, response, error);
    if (signal.aborted
      || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
      return mapRequestFailure(error, signal);
    }
    if (error instanceof AuthLoginError) throw error;
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }
}

export async function authenticateAndAuthorizeDatasul(
  login: string,
  senha: string,
  config: DatasulAuthConfig,
  dependencies: DatasulAuthClientDependencies,
): Promise<DatasulIdentity> {
  const authorization = basicAuthorization(login, senha);
  const users = await getJson(
    new URL('/api/btb/v1/usuarios', config.baseUrl).toString(),
    authorization,
    config,
    dependencies,
    'authenticate_user',
    '/api/btb/v1/usuarios',
    validateEnvelope,
  );
  // A API de usuários é um catálogo paginado com campos `code`/`name`.
  // O sucesso autenticado valida as credenciais, mas a primeira página não
  // necessariamente contém o próprio usuário. A identidade canônica deste
  // login vem da API de segurança, que é consultada pelo código informado.
  void users;

  const access = await Promise.all(DATASUL_SECURITY_PROGRAMS.map(async definition => {
    return getProgramAccess(login, authorization, definition.program, config, dependencies);
  }));
  const permissoes: AppPermission[] = [APP_PERMISSIONS.mainMenu];
  DATASUL_SECURITY_PROGRAMS.forEach((definition, index) => {
    if (access[index]?.allowed) {
      permissoes.push(definition.permission);
    }
  });

  const userName = access[0]?.userName;
  if (!userName) {
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }

  return {
    codUsuario: login,
    nomUsuario: userName,
    permissoes,
  };
}

async function getProgramAccess(
  login: string,
  authorization: string,
  program: DatasulSecurityProgram,
  config: DatasulAuthConfig,
  dependencies: DatasulAuthClientDependencies,
): Promise<DatasulProgramAccess> {
  const securityPath = [login, program]
    .map(segment => encodeURIComponent(segment))
    .join('/');
  const security = await getJson(
    new URL(`/api/fcq/v1/seguranca/${securityPath}`, config.baseUrl).toString(),
    authorization,
    config,
    dependencies,
    'authorize_program',
    '/api/fcq/v1/seguranca/:usuario/:programa',
    value => validateProgramAccess(value, login, program),
  );
  return security;
}

function validateProgramAccess(
  value: unknown,
  login: string,
  program: DatasulSecurityProgram,
): DatasulProgramAccess {
  const items = validateEnvelope(value);
  if (items.length !== 1 || !isRecord(items[0])) {
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }

  const item = items[0];
  if (item['codUsuario'] !== login
    || item['programa'] !== program
    || typeof item['nomUsuario'] !== 'string'
    || item['nomUsuario'].length === 0
    || typeof item['temAcesso'] !== 'boolean') {
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }
  return {
    allowed: item['temAcesso'],
    userName: item['nomUsuario'],
  };
}
