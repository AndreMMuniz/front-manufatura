import { noopLogger, type ApplicationLogger } from './logging/log-contracts';
import {
  observeUpstreamFetch,
  reportInvalidUpstreamResponse,
  type UpstreamRequestDetails,
} from './server-upstream-observability';

export type QualityControlEnvironment = Record<string, string | undefined>;

export interface QualityControlDatasulConfig {
  readonly baseUrl: URL;
  readonly companyId: number;
  readonly integrationUser: string;
  readonly integrationPassword: string;
  readonly requestTimeoutMs: number;
}

export class QualityControlGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'QualityControlGatewayError';
  }
}

export type QualityControlTransport = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

export function readQualityControlDatasulConfig(
  env: QualityControlEnvironment,
): QualityControlDatasulConfig {
  let baseUrl: URL;
  try {
    baseUrl = new URL(env['DATASUL_BASE_URL'] ?? '');
  } catch {
    throw new QualityControlGatewayError(503, 'quality-control-gateway-not-configured');
  }
  const companyId = Number(env['DATASUL_COMPANY_ID']);
  const requestTimeoutMs = Number(env['DATASUL_REQUEST_TIMEOUT_MS']);
  const integrationUser = env['DATASUL_INTEGRATION_USER']?.trim() ?? '';
  const integrationPassword = env['DATASUL_INTEGRATION_PASSWORD'] ?? '';
  if (
    !['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.username
    || baseUrl.password
    || !Number.isSafeInteger(companyId)
    || companyId <= 0
    || !Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs <= 0
    || requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
    || !integrationUser
    || integrationUser.includes(':')
    || /[\u0000-\u001f\u007f]/u.test(integrationUser)
    || !integrationPassword
  ) {
    throw new QualityControlGatewayError(503, 'quality-control-gateway-not-configured');
  }
  return { baseUrl, companyId, integrationUser, integrationPassword, requestTimeoutMs };
}

export class QualityControlDatasulClient {
  constructor(
    private readonly config: QualityControlDatasulConfig,
    private readonly transport: QualityControlTransport = fetch,
    private readonly timeoutSignal: (timeoutMs: number) => AbortSignal = AbortSignal.timeout,
    private readonly logger: ApplicationLogger = noopLogger,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  getOrder(orderNumber: number): Promise<unknown> {
    return this.request('GET', `/api/fcq/v1/ordens/${orderNumber}`, undefined, undefined,
      'get_quality_order', '/api/fcq/v1/ordens/:id');
  }

  getRoute(body: { readonly nrOrdemProducao: number; readonly codOperacao: number }): Promise<unknown> {
    return this.request('POST', '/api/fcq/v1/roteiros', body, 'companyid',
      'get_quality_route', '/api/fcq/v1/roteiros');
  }

  saveResult(body: Record<string, number | string>): Promise<unknown> {
    return this.request('PUT', '/api/fcq/v1/resultexames', body, 'companyId',
      'save_quality_result', '/api/fcq/v1/resultexames');
  }

  finalizeRoute(body: { readonly nrFicha: number; readonly codUsuario: string }): Promise<unknown> {
    return this.request('PUT', '/api/fcq/v1/FinalizaRoteiros', body, 'companyId',
      'finalize_quality_route', '/api/fcq/v1/FinalizaRoteiros');
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: object,
    companyParameter?: 'companyid' | 'companyId',
    operation = 'quality_control_request',
    observableRoute = '/api/fcq/v1',
  ): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl);
    if (companyParameter) url.searchParams.set(companyParameter, String(this.config.companyId));
    const authorization = Buffer.from(
      `${this.config.integrationUser}:${this.config.integrationPassword}`,
      'utf8',
    ).toString('base64');
    const observation: UpstreamRequestDetails = {
      system: 'datasul', operation, method, route: observableRoute,
      protocol: this.config.baseUrl.protocol as 'http:' | 'https:',
      destinationHost: this.config.baseUrl.host,
    };
    let response: Response;
    try {
      response = await observeUpstreamFetch(this.logger, observation, () => this.transport(url, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Basic ${authorization}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: this.timeoutSignal(this.config.requestTimeoutMs),
        }), this.clock);
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new QualityControlGatewayError(504, 'datasul-timeout');
      }
      throw new QualityControlGatewayError(502, 'datasul-unavailable');
    }
    if (!response.ok) {
      throw new QualityControlGatewayError(
        response.status === 401 || response.status === 403 ? 502 : response.status,
        'datasul-request-failed',
      );
    }
    try {
      return await response.json() as unknown;
    } catch (error) {
      reportInvalidUpstreamResponse(this.logger, observation, response.status);
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new QualityControlGatewayError(504, 'datasul-timeout');
      }
      throw new QualityControlGatewayError(502, 'invalid-upstream-response');
    }
  }
}
