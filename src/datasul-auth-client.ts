import { AuthLoginError } from './auth-login-error';

export type HttpTransport = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DatasulAuthConfig {
  baseUrl: string;
  securityProgram: 'fcq-0001';
  requestTimeoutMs: number;
}

export interface DatasulIdentity {
  codUsuario: string;
  nomUsuario: string;
}

export interface DatasulAuthClientDependencies {
  transport: HttpTransport;
  timeoutSignal: (timeoutMs: number) => AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }
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
    || (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
    throw new AuthLoginError(504, 'datasul-timeout');
  }
  throw new AuthLoginError(502, 'datasul-unavailable');
}

async function getJson(
  url: string,
  authorization: string,
  config: DatasulAuthConfig,
  dependencies: DatasulAuthClientDependencies,
): Promise<unknown> {
  const signal = dependencies.timeoutSignal(config.requestTimeoutMs);
  let response: Response;
  try {
    response = await dependencies.transport(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    return mapRequestFailure(error, signal);
  }

  if (response.status === 401) {
    throw new AuthLoginError(401, 'invalid-credentials');
  }
  if (!response.ok) {
    throw new AuthLoginError(502, 'datasul-unavailable');
  }
  return safeJson(response);
}

export async function authenticateAndAuthorizeDatasul(
  login: string,
  senha: string,
  config: DatasulAuthConfig,
  dependencies: DatasulAuthClientDependencies,
): Promise<DatasulIdentity> {
  const authorization = basicAuthorization(login, senha);
  const users = await getJson(
    new URL('/api/gtb/v1/usuarios', config.baseUrl).toString(),
    authorization,
    config,
    dependencies,
  );
  validateEnvelope(users);

  const securityPath = [login, config.securityProgram]
    .map(segment => encodeURIComponent(segment))
    .join('/');
  const security = await getJson(
    new URL(`/api/fcq/v1/seguranca/${securityPath}`, config.baseUrl).toString(),
    authorization,
    config,
    dependencies,
  );
  const items = validateEnvelope(security);
  if (items.length !== 1 || !isRecord(items[0])) {
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }

  const item = items[0];
  if (item['codUsuario'] !== login
    || item['programa'] !== config.securityProgram
    || typeof item['nomUsuario'] !== 'string'
    || item['nomUsuario'].length === 0
    || typeof item['temAcesso'] !== 'boolean') {
    throw new AuthLoginError(502, 'invalid-upstream-response');
  }
  if (item['temAcesso'] === false) {
    throw new AuthLoginError(403, 'access-denied');
  }

  return { codUsuario: login, nomUsuario: item['nomUsuario'] };
}
