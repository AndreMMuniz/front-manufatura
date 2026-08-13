export type FmaEnvironment = Record<string, string | undefined>;
export type FmaTransport = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FmaDatasulConfig {
  readonly baseUrl: URL;
  readonly companyId: number;
  readonly integrationUser: string;
  readonly integrationPassword: string;
  readonly requestTimeoutMs: number;
}

export class FmaGatewayError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'FmaGatewayError';
  }
}

const MAX_TIMEOUT = 2_147_483_647;

export function readFmaDatasulConfig(env: FmaEnvironment): FmaDatasulConfig {
  let baseUrl: URL;
  try {
    baseUrl = new URL(env['DATASUL_BASE_URL'] ?? '');
  } catch {
    throw new FmaGatewayError(503, 'fma-gateway-not-configured');
  }
  const companyId = Number(env['DATASUL_COMPANY_ID']);
  const requestTimeoutMs = Number(env['DATASUL_REQUEST_TIMEOUT_MS']);
  const integrationUser = env['DATASUL_INTEGRATION_USER']?.trim() ?? '';
  const integrationPassword = env['DATASUL_INTEGRATION_PASSWORD'] ?? '';
  if (!['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.username || baseUrl.password
    || !Number.isSafeInteger(companyId) || companyId <= 0
    || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > MAX_TIMEOUT
    || !integrationUser || integrationUser.includes(':')
    || /[\u0000-\u001f\u007f]/u.test(integrationUser)
    || !integrationPassword) {
    throw new FmaGatewayError(503, 'fma-gateway-not-configured');
  }
  return { baseUrl, companyId, integrationUser, integrationPassword, requestTimeoutMs };
}

export class FmaDatasulClient {
  constructor(
    private readonly config: FmaDatasulConfig,
    private readonly transport: FmaTransport = fetch,
    private readonly timeoutSignal: (timeoutMs: number) => AbortSignal = AbortSignal.timeout,
  ) {}

  getWorkCenters(userId: string, areaCode: string): Promise<ReadonlyArray<Record<string, unknown>>> {
    return this.request('GET', '/api/fma/v1/centrostrabalho', 'centrosTrabalho', userId, { codAreaProduc: areaCode });
  }

  getReleasedOrders(userId: string, areaCode: string, workCenterCode: string): Promise<ReadonlyArray<Record<string, unknown>>> {
    return this.request('GET', '/api/fma/v1/ordensliberadas', 'ordensLiberadas', userId, { codAreaProduc: areaCode, codCtrab: workCenterCode });
  }

  openOperation(userId: string, query: Readonly<Record<string, string | number>>): Promise<ReadonlyArray<Record<string, unknown>>> {
    return this.request('GET', '/api/fma/v1/abrirapontamento', 'dadosApontamento', userId, query);
  }

  startOperation(userId: string, body: Readonly<Record<string, string | number>>): Promise<ReadonlyArray<Record<string, unknown>>> {
    return this.request('POST', '/api/fma/v1/iniciaordem', 'inicioOrdem', userId, {}, body);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    dataset: string,
    userId: string,
    query: Readonly<Record<string, string | number>>,
    body?: Readonly<Record<string, string | number>>,
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    const url = new URL(path, this.config.baseUrl);
    url.searchParams.set('companyId', String(this.config.companyId));
    url.searchParams.set('codUsuario', userId);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const signal = this.timeoutSignal(this.config.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.transport(url, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.integrationUser}:${this.config.integrationPassword}`, 'utf8').toString('base64')}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))) {
        throw new FmaGatewayError(504, 'datasul-timeout');
      }
      throw new FmaGatewayError(502, 'datasul-unavailable');
    }
    if (!response.ok) throw new FmaGatewayError(502, 'datasul-unavailable');
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new FmaGatewayError(502, 'invalid-upstream-response'); }
    return datasetRows(payload, dataset);
  }
}

function datasetRows(value: unknown, dataset: string): ReadonlyArray<Record<string, unknown>> {
  if (!record(value) || !Array.isArray(value['items']) || typeof value['hasNext'] !== 'boolean'
    || !Number.isSafeInteger(value['total']) || (value['total'] as number) < 0) {
    throw new FmaGatewayError(502, 'invalid-upstream-response');
  }
  const rows: Record<string, unknown>[] = [];
  for (const item of value['items']) {
    if (!record(item) || !Array.isArray(item[dataset])) throw new FmaGatewayError(502, 'invalid-upstream-response');
    for (const row of item[dataset]) {
      if (!record(row)) throw new FmaGatewayError(502, 'invalid-upstream-response');
      rows.push(row);
    }
  }
  return rows;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
