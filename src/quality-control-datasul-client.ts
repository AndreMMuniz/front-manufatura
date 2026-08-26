import { noopLogger, type ApplicationLogger } from './logging/log-contracts';
import {
  observeUpstreamFetch,
  reportUpstreamRequestCompleted,
  reportUpstreamResponseFailure,
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

export type GatewayCommandErrorDetails = {
  readonly category: 'TRANSIENT' | 'AUTH' | 'VALIDATION' | 'CONFLICT';
  readonly deliveryOutcome: 'NOT_DELIVERED' | 'REJECTED' | 'UNCERTAIN';
  readonly userMessage: string;
};

export class QualityControlGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    details: GatewayCommandErrorDetails = legacyGatewayDetails(status, code),
  ) {
    super(code);
    this.name = 'QualityControlGatewayError';
    this.category = details.category;
    this.deliveryOutcome = details.deliveryOutcome;
    this.userMessage = details.userMessage;
  }

  readonly category: GatewayCommandErrorDetails['category'];
  readonly deliveryOutcome: GatewayCommandErrorDetails['deliveryOutcome'];
  readonly userMessage: string;
}

export type QualityControlTransport = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

export function readQualityControlDatasulConfig(env: QualityControlEnvironment): QualityControlDatasulConfig {
  let baseUrl: URL;
  try {
    baseUrl = new URL(env['DATASUL_BASE_URL'] ?? '');
  } catch {
    throw new QualityControlGatewayError(
      503, 'quality-control-gateway-not-configured', notConfiguredDetails(),
    );
  }
  const companyId = Number(env['DATASUL_COMPANY_ID']);
  const requestTimeoutMs = Number(env['DATASUL_REQUEST_TIMEOUT_MS']);
  const integrationUser = env['DATASUL_INTEGRATION_USER']?.trim() ?? '';
  const integrationPassword = env['DATASUL_INTEGRATION_PASSWORD'] ?? '';
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    !Number.isSafeInteger(companyId) ||
    companyId <= 0 ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS ||
    !integrationUser ||
    integrationUser.includes(':') ||
    /[\u0000-\u001f\u007f]/u.test(integrationUser) ||
    !integrationPassword
  ) {
    throw new QualityControlGatewayError(
      503, 'quality-control-gateway-not-configured', notConfiguredDetails(),
    );
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
    return this.request(
      'GET',
      `/api/fcq/v1/ordens/${orderNumber}`,
      undefined,
      undefined,
      'get_quality_order',
      '/api/fcq/v1/ordens/:id',
    );
  }

  getRoute(body: {
    readonly nrOrdemProducao: number;
    readonly codOperacao: number;
    readonly codOperador?: string;
    readonly codEquipe?: string;
  }): Promise<unknown> {
    return this.request('POST', '/api/fcq/v1/roteiros', body, 'companyid', 'get_quality_route', '/api/fcq/v1/roteiros');
  }

  saveResult(body: Record<string, number | string>): Promise<unknown> {
    return this.request(
      'PUT',
      '/api/fcq/v1/resultexames',
      body,
      'companyId',
      'save_quality_result',
      '/api/fcq/v1/resultexames',
      validateResultEnvelope,
    );
  }

  finalizeRoute(body: { readonly nrFicha: number; readonly codUsuario: string }): Promise<unknown> {
    return this.request(
      'PUT',
      '/api/fcq/v1/FinalizaRoteiros',
      body,
      'companyId',
      'finalize_quality_route',
      '/api/fcq/v1/FinalizaRoteiros',
    );
  }

  getRoutesPendingAuthorization(query: {
    readonly codUsuario: string;
  } | {
    readonly nrOrdemProducao: number;
    readonly opCodigo: number;
    readonly codUsuario: string;
  }): Promise<unknown> {
    const search = new URLSearchParams({
      companyId: String(this.config.companyId),
      codUsuario: query.codUsuario,
    });
    if ('nrOrdemProducao' in query) {
      search.set('nrOrdemProducao', String(query.nrOrdemProducao));
      search.set('opCodigo', String(query.opCodigo));
    }
    return this.request(
      'GET',
      `/api/fcq/v1/autorizacaoroteiros?${search}`,
      undefined,
      undefined,
      'list_quality_route_authorizations',
      '/api/fcq/v1/autorizacaoroteiros',
      validatePendingAuthorizationsEnvelope,
    );
  }

  getPendingRoute(query: { readonly nrFicha: number; readonly codUsuario: string }): Promise<unknown> {
    const search = new URLSearchParams({
      companyId: String(this.config.companyId),
      codUsuario: query.codUsuario,
      nrFicha: String(query.nrFicha),
    });
    return this.request(
      'GET',
      `/api/fcq/v1/roteiropendente?${search}`,
      undefined,
      undefined,
      'get_quality_pending_route',
      '/api/fcq/v1/roteiropendente',
    );
  }

  finalizeRouteWithAuthorization(body: { readonly nrFicha: number; readonly codUsuario: string }): Promise<unknown> {
    return this.request(
      'POST',
      '/api/fcq/v1/finalizaroteirosautorizado',
      body,
      'companyId',
      'finalize_quality_route_authorized',
      '/api/fcq/v1/finalizaroteirosautorizado',
      validateAuthorizedFinalizationEnvelope,
    );
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: object,
    companyParameter?: 'companyid' | 'companyId',
    operation = 'quality_control_request',
    observableRoute = '/api/fcq/v1',
    validateResponse?: (value: unknown) => void,
  ): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl);
    if (companyParameter) url.searchParams.set(companyParameter, String(this.config.companyId));
    const authorization = Buffer.from(
      `${this.config.integrationUser}:${this.config.integrationPassword}`,
      'utf8',
    ).toString('base64');
    const observation: UpstreamRequestDetails = {
      system: 'datasul',
      operation,
      method,
      route: observableRoute,
      protocol: this.config.baseUrl.protocol as 'http:' | 'https:',
      destinationHost: this.config.baseUrl.host,
    };
    let response: Response;
    try {
      response = await observeUpstreamFetch(
        this.logger,
        observation,
        () =>
          this.transport(url, {
            method,
            headers: {
              Accept: 'application/json',
              Authorization: `Basic ${authorization}`,
              ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: this.timeoutSignal(this.config.requestTimeoutMs),
          }),
        this.clock,
      );
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new QualityControlGatewayError(504, 'datasul-timeout', timeoutDetails());
      }
      throw new QualityControlGatewayError(502, 'datasul-unavailable', transportFailureDetails(error));
    }
    if (!response.ok) {
      throw new QualityControlGatewayError(
        response.status === 401 || response.status === 403 ? 502 : response.status,
        'datasul-request-failed',
        upstreamFailureDetails(response.status),
      );
    }
    try {
      const parsed = (await response.json()) as unknown;
      validateResponse?.(parsed);
      reportUpstreamRequestCompleted(this.logger, observation, response);
      return parsed;
    } catch (error) {
      reportUpstreamResponseFailure(this.logger, observation, response, error);
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new QualityControlGatewayError(504, 'datasul-timeout', timeoutDetails());
      }
      throw new QualityControlGatewayError(502, 'invalid-upstream-response', invalidReceiptDetails());
    }
  }
}

function legacyGatewayDetails(status: number, code: string): GatewayCommandErrorDetails {
  if (code === 'quality-control-gateway-not-configured') return notConfiguredDetails();
  if (code === 'invalid-session' || code === 'access-denied') return {
    category: 'AUTH', deliveryOutcome: 'NOT_DELIVERED', userMessage: 'Sua sessão não permite concluir a solicitação.',
  };
  if (code === 'invalid-upstream-response') return invalidReceiptDetails();
  if (code === 'datasul-timeout') return timeoutDetails();
  if (code === 'datasul-request-failed') return upstreamFailureDetails(status);
  if (status === 409) return {
    category: 'CONFLICT', deliveryOutcome: 'REJECTED', userMessage: 'A solicitação conflita com um registro existente.',
  };
  if (status >= 400 && status < 500) return {
    category: 'VALIDATION', deliveryOutcome: 'REJECTED', userMessage: 'A solicitação foi recusada.',
  };
  return {
    category: 'TRANSIENT', deliveryOutcome: 'UNCERTAIN',
    userMessage: 'Não foi possível confirmar a gravação no destino.',
  };
}

function notConfiguredDetails(): GatewayCommandErrorDetails {
  return {
    category: 'TRANSIENT', deliveryOutcome: 'NOT_DELIVERED',
    userMessage: 'A integração com o destino não está disponível.',
  };
}

function timeoutDetails(): GatewayCommandErrorDetails {
  return {
    category: 'TRANSIENT', deliveryOutcome: 'UNCERTAIN',
    userMessage: 'O destino não confirmou a gravação a tempo.',
  };
}

function invalidReceiptDetails(): GatewayCommandErrorDetails {
  return {
    category: 'TRANSIENT', deliveryOutcome: 'UNCERTAIN',
    userMessage: 'O destino respondeu, mas a gravação ainda precisa ser confirmada.',
  };
}

function transportFailureDetails(error: unknown): GatewayCommandErrorDetails {
  return provedConnectionFailure(error)
    ? {
        category: 'TRANSIENT', deliveryOutcome: 'NOT_DELIVERED',
        userMessage: 'Não foi possível iniciar a comunicação com o destino.',
      }
    : {
        category: 'TRANSIENT', deliveryOutcome: 'UNCERTAIN',
        userMessage: 'A comunicação com o destino foi interrompida; confirme antes de reenviar.',
      };
}

function upstreamFailureDetails(status: number): GatewayCommandErrorDetails {
  if (status >= 400 && status < 500) {
    return {
      category: 'VALIDATION', deliveryOutcome: 'REJECTED', userMessage: 'O destino recusou a solicitação.',
    };
  }
  return {
    category: 'TRANSIENT', deliveryOutcome: 'UNCERTAIN',
    userMessage: 'O destino não confirmou a gravação.',
  };
}

function provedConnectionFailure(error: unknown): boolean {
  const causes = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH']);
  let candidate = error;
  for (let depth = 0; depth < 3 && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as { code?: unknown; cause?: unknown };
    if (typeof record.code === 'string' && causes.has(record.code)) return true;
    candidate = record.cause;
  }
  return false;
}

function validatePendingAuthorizationsEnvelope(value: unknown): void {
  const envelope = authorizationEnvelope(value);
  const sheetNumbers: number[] = [];
  for (const itemValue of optionalArray(envelope['items'])) {
    const item = upstreamObject(itemValue);
    const dataset = item['ds-autorizacao'] === undefined ? item : upstreamObject(item['ds-autorizacao']);
    for (const routeValue of optionalArray(dataset['roteirosEmAnalise'])) {
      const route = upstreamObject(routeValue);
      sheetNumbers.push(upstreamPositiveInteger(route['nrFicha']));
      upstreamPositiveInteger(route['nrOrdemProducao']);
      upstreamText(route['codItem'], false);
      upstreamText(route['descricaoItem'], false);
      upstreamPositiveInteger(route['sequenciaOperacao']);
      upstreamNonNegativeInteger(route['situacao']);
      upstreamBoolean(route['liberada']);
      upstreamBoolean(route['inspecionado']);
      const total = upstreamNonNegativeInteger(route['componentesTotal']);
      const outOfRange = upstreamNonNegativeInteger(route['componentesForaFaixa']);
      if (outOfRange > total) throw invalidUpstream();
      upstreamText(route['narrativa'], true);
      const results = requiredArray(route['resultados']);
      const identities = results.map(resultValue => {
        const result = upstreamObject(resultValue);
        if (upstreamPositiveInteger(result['nrFicha']) !== route['nrFicha']) throw invalidUpstream();
        const examCode = upstreamPositiveInteger(result['codExame']);
        const componentCode = upstreamPositiveInteger(result['codComponente']);
        upstreamNonNegativeInteger(result['seqComp']);
        upstreamPositiveInteger(result['tipoResultado']);
        upstreamFiniteNumber(result['resultado']);
        upstreamText(result['laudo'], true);
        upstreamNonNegativeInteger(result['nrTabela']);
        upstreamBoolean(result['dentroFaixa']);
        return `${examCode}:${componentCode}`;
      });
      if (
        results.length !== total ||
        results.filter(value => !upstreamBoolean(upstreamObject(value)['dentroFaixa'])).length !== outOfRange ||
        new Set(identities).size !== identities.length
      )
        throw invalidUpstream();
    }
  }
  if (new Set(sheetNumbers).size !== sheetNumbers.length) throw invalidUpstream();
}

function validateAuthorizedFinalizationEnvelope(value: unknown): void {
  const envelope = authorizationEnvelope(value);
  for (const itemValue of optionalArray(envelope['items'])) {
    const item = upstreamObject(itemValue);
    if (item['ds-finaliza'] === undefined) continue;
    const result = upstreamObject(item['ds-finaliza']);
    for (const routeValue of optionalArray(result['roteiro'])) {
      const route = upstreamObject(routeValue);
      upstreamPositiveInteger(route['nrFicha']);
      upstreamNonNegativeInteger(route['situacao']);
      upstreamText(route['mensagem'], false);
      upstreamBoolean(route['inspecionado']);
      upstreamBoolean(route['finalizado']);
      const total = upstreamNonNegativeInteger(route['componentesTotal']);
      const saved = upstreamNonNegativeInteger(route['componentesSalvos']);
      const pending = upstreamNonNegativeInteger(route['componentesPendentes']);
      if (saved + pending !== total || upstreamNonNegativeInteger(route['componentesForaFaixa']) > total)
        throw invalidUpstream();
      for (const examValue of optionalArray(route['exames'])) {
        const exam = upstreamObject(examValue);
        upstreamPositiveInteger(exam['nrFicha']);
        upstreamPositiveInteger(exam['codExame']);
        const examTotal = upstreamNonNegativeInteger(exam['componentesTotal']);
        const examSaved = upstreamNonNegativeInteger(exam['componentesSalvos']);
        const examPending = upstreamNonNegativeInteger(exam['componentesPendentes']);
        if (examSaved + examPending !== examTotal) throw invalidUpstream();
      }
    }
  }
}

function validateResultEnvelope(value: unknown): void {
  const envelope = upstreamObject(value);
  if (
    envelope['total'] !== 1 ||
    envelope['hasNext'] !== false ||
    !Array.isArray(envelope['items']) ||
    envelope['items'].length !== 1
  )
    throw invalidUpstream();
  const item = upstreamObject(envelope['items'][0]);
  upstreamPositiveInteger(item['nrFicha']);
  upstreamPositiveInteger(item['codExame']);
  upstreamPositiveInteger(item['codComponente']);
  upstreamNullableBoolean(item['dentroFaixa']);
  const saved = upstreamNonNegativeInteger(item['componentesSalvos']);
  const total = upstreamNonNegativeInteger(item['componentesTotal']);
  if (saved > total) throw invalidUpstream();
}

function authorizationEnvelope(value: unknown): Record<string, unknown> {
  const envelope = upstreamObject(value);
  upstreamNonNegativeInteger(envelope['total']);
  if (upstreamBoolean(envelope['hasNext'])) throw invalidUpstream();
  optionalArray(envelope['items']);
  return envelope;
}

function upstreamObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidUpstream();
  return value as Record<string, unknown>;
}

function optionalArray(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidUpstream();
  return value;
}

function requiredArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidUpstream();
  return value;
}

function upstreamPositiveInteger(value: unknown): number {
  const result = upstreamNonNegativeInteger(value);
  if (result === 0) throw invalidUpstream();
  return result;
}

function upstreamNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidUpstream();
  return value as number;
}

function upstreamBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidUpstream();
  return value;
}

function upstreamNullableBoolean(value: unknown): boolean | null {
  return value === null ? null : upstreamBoolean(value);
}

function upstreamFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidUpstream();
  return value;
}

function upstreamText(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw invalidUpstream();
  return value;
}

function invalidUpstream(): Error {
  return new Error('invalid-upstream-response');
}
