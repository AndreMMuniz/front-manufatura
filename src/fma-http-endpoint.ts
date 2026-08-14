import express, { type Application, type Request, type Response as ExpressResponse } from 'express';

import { APP_PERMISSIONS } from './app-permissions';
import { verifyAppSessionToken } from './app-session-token';
import {
  QualityControlGatewayError,
  readQualityControlDatasulConfig,
  type QualityControlEnvironment,
  type QualityControlTransport,
} from './quality-control-datasul-client';
import { noopLogger, type ApplicationLogger } from './logging/log-contracts';
import { normalizedRoute } from './server-observability';
import {
  observeUpstreamFetch,
  reportInvalidUpstreamResponse,
  type UpstreamRequestDetails,
} from './server-upstream-observability';

const FMA_PERMISSIONS = [
  APP_PERMISSIONS.operationReporting,
  APP_PERMISSIONS.batchReporting,
  APP_PERMISSIONS.stoppages,
] as const;

export interface FmaEndpointDependencies {
  readonly env: QualityControlEnvironment;
  readonly transport?: QualityControlTransport;
  readonly timeoutSignal?: (timeoutMs: number) => AbortSignal;
  readonly now?: () => Date;
  readonly logger?: ApplicationLogger;
  readonly clock?: () => number;
}

type JsonObject = Record<string, unknown>;

export function installFmaEndpoints(app: Application, dependencies: FmaEndpointDependencies): void {
  const startRequests = new Map<string, {
    readonly canonical: string;
    readonly promise: Promise<ReturnType<typeof receipt>>;
  }>();
  const roots = [
    '/api/production-areas', '/api/work-centers', '/api/operators',
    '/api/operational-responsibles', '/api/teams', '/api/scrap-reasons',
    '/api/stop-reasons', '/api/production-orders', '/api/operations',
    '/api/batches', '/api/production-stops',
  ];
  for (const root of roots) app.use(root, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '64kb' }));

  app.get('/api/work-centers', (req, res) => handle(req, res, dependencies, async client => {
    const areaCode = optionalText(req.query['areaCode']);
    const upstream = await client.request('GET', '/api/fma/v1/centrostrabalho', undefined, {
      ...(areaCode ? { codAreaProduc: areaCode } : {}),
    });
    const term = optionalText(req.query['term']).toLocaleLowerCase('pt-BR');
    return dataset(upstream, 'centrosTrabalho').map(row => {
      const item = objectOf(row);
      return {
        code: text(item['codCtrab']),
        description: text(item['desCtrab']),
        areaCode: text(item['codAreaProduc']),
        area: '',
        machineGroup: '',
        establishment: '',
        active: true,
      };
    }).filter(center => !term || `${center.code} ${center.description}`.toLocaleLowerCase('pt-BR').includes(term));
  }));

  app.get('/api/production-orders', (req, res) => handle(req, res, dependencies, async client => {
    const areaCode = requiredText(req.query['areaCode']);
    const workCenterCode = requiredText(req.query['workCenterCode']);
    const upstream = await client.request('GET', '/api/fma/v1/ordensliberadas', undefined, {
      codAreaProduc: areaCode,
      codCtrab: workCenterCode,
    });
    return dataset(upstream, 'ordensLiberadas').map(row => {
      const item = objectOf(row);
      const ordem = integerText(item['nrOrdemProducao']);
      const itemOp = text(item['codItemOp']);
      const operacao = integerText(item['opCodigo']);
      const split = integerText(item['numSplitOperac']);
      return {
        id: `${ordem}|${itemOp}|${operacao}|${split}`,
        ordem, itemOp, operacao, split, areaCode, workCenterCode,
      };
    });
  }));

  app.get('/api/production-orders/:order/operations/:operation', (req, res) =>
    handle(req, res, dependencies, async client => {
      const areaCode = requiredText(req.query['areaCode']);
      const workCenterCode = requiredText(req.query['workCenterCode']);
      const upstream = await client.request('GET', '/api/fma/v1/abrirapontamento', undefined, {
        codAreaProduc: areaCode,
        codCtrab: workCenterCode,
        nrOrdemProducao: positiveInteger(req.params['order']),
        opCodigo: positiveInteger(req.params['operation']),
        numSplitOperac: positiveInteger(req.query['split']),
      });
      const item = objectOf(single(dataset(upstream, 'dadosApontamento')));
      return {
        ordem: integerText(item['nrOrdemProducao']),
        op: integerText(item['opCodigo']),
        split: integerText(item['numSplitOperac']),
        item: text(item['itCodigo']),
        descricao: text(item['descItem']),
        unidade: text(item['un']),
        roteiro: `${integerText(item['opCodigo'])} - ${text(item['desOperacao'])}`,
        quantidadeOrdem: finiteNumber(item['qtdOrdem']),
        quantidadeSaldo: finiteNumber(item['qtdSaldo']),
        linha: text(item['desCtrab']),
        ct: text(item['codCtrab']),
        grupoMaquina: text(item['desGrupoMaquina']),
        operador: '', equipe: '', turno: text(item['desModelTurno']),
      };
    }));

  app.post('/api/operations/start', (req, res) => handle(req, res, dependencies, async client => {
    const body = objectOf(req.body);
    const responsibleType = requiredText(body['tipoResponsavel']);
    const responsibleCode = requiredText(body['codigoResponsavel']);
    if (responsibleType !== 'OPERADOR' && responsibleType !== 'EQUIPE') {
      throw new QualityControlGatewayError(400, 'invalid-request');
    }
    const command = {
      codAreaProduc: requiredText(body['areaCode']),
      codCtrab: requiredText(body['workCenterCode']),
      nrOrdemProducao: positiveInteger(body['ordem']),
      opCodigo: positiveInteger(body['op']),
      numSplitOperac: positiveInteger(body['split']),
      dataInicioReporte: isoDate(body['dataInicio']),
      horaInicioReporte: requiredText(body['horaInicio']),
      codOperador: responsibleType === 'OPERADOR' ? responsibleCode : '',
      codEquipe: responsibleType === 'EQUIPE' ? responsibleCode : '',
      codFerramenta: '', dataInicioSetup: '', horaInicioSetup: '', dataFimSetup: '', horaFimSetup: '',
    };
    const idempotencyKey = safeId(req.header('idempotency-key'));
    const cacheKey = `${client.subject}\u0000${idempotencyKey}`;
    const canonical = JSON.stringify(command);
    const existing = startRequests.get(cacheKey);
    if (existing) {
      if (existing.canonical !== canonical) {
        throw new QualityControlGatewayError(409, 'idempotency-conflict');
      }
      return { ...(await existing.promise), duplicate: true };
    }
    const promise = (async () => {
      const upstream = await client.request('POST', '/api/fma/v1/iniciaordem', command);
      const result = objectOf(single(dataset(upstream, 'inicioOrdem')));
      return receipt(
        idempotencyKey,
        `datasul:operation:${integerText(result['nrOrdemProducao'])}:${integerText(result['opCodigo'])}:${integerText(result['numSplitOperac'])}`,
        dependencies.now?.() ?? new Date(),
      );
    })();
    startRequests.set(cacheKey, { canonical, promise });
    try {
      return await promise;
    } catch (error) {
      startRequests.delete(cacheKey);
      throw error;
    }
  }));

  installTransparentRoutes(app, dependencies);
}

function installTransparentRoutes(app: Application, dependencies: FmaEndpointDependencies): void {
  const reads = [
    '/api/production-areas', '/api/operators', '/api/operational-responsibles',
    '/api/teams', '/api/teams/:code', '/api/scrap-reasons', '/api/stop-reasons',
  ];
  for (const path of reads) app.get(path, (req, res) => handle(req, res, dependencies, client =>
    client.request('GET', concretePath(req), undefined, queryObject(req), normalizedRoute(req))));
  app.post('/api/teams', (req, res) => handle(req, res, dependencies, client =>
    client.request('POST', '/api/teams', objectOf(req.body), {}, normalizedRoute(req))));
  app.put('/api/teams/:code', (req, res) => handle(req, res, dependencies, client =>
    client.request('PUT', concretePath(req), objectOf(req.body), {}, normalizedRoute(req))));

  const commands = [
    '/api/operations/report', '/api/operations/end', '/api/batches/start',
    '/api/batches/report', '/api/batches/end', '/api/production-stops',
    '/api/production-stops/:id/finish',
  ];
  for (const path of commands) app.post(path, (req, res) => handle(req, res, dependencies, client =>
    client.request('POST', concretePath(req), objectOf(req.body), queryObject(req), normalizedRoute(req))));
}

class FmaClient {
  private readonly config;
  constructor(
    readonly subject: string,
    private readonly dependencies: FmaEndpointDependencies,
  ) {
    this.config = readQualityControlDatasulConfig(dependencies.env);
  }

  async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: object,
    query: Record<string, string | number> = {},
    observableRoute = path,
  ): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl);
    url.searchParams.set('companyId', String(this.config.companyId));
    url.searchParams.set('codUsuario', this.subject);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const authorization = Buffer.from(`${this.config.integrationUser}:${this.config.integrationPassword}`, 'utf8').toString('base64');
    const observation: UpstreamRequestDetails = {
      system: 'datasul',
      operation: operationName(method, observableRoute),
      method,
      route: observableRoute,
      protocol: this.config.baseUrl.protocol as 'http:' | 'https:',
      destinationHost: this.config.baseUrl.host,
    };
    let response: globalThis.Response;
    try {
      response = await observeUpstreamFetch(
        this.dependencies.logger ?? noopLogger,
        observation,
        () => (this.dependencies.transport ?? fetch)(url, {
          method,
          headers: {
            Accept: 'application/json', Authorization: `Basic ${authorization}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: (this.dependencies.timeoutSignal ?? AbortSignal.timeout)(this.config.requestTimeoutMs),
        }),
        this.dependencies.clock,
      );
    } catch {
      throw new QualityControlGatewayError(502, 'datasul-unavailable');
    }
    if (!response.ok) throw new QualityControlGatewayError(response.status, 'datasul-request-failed');
    try { return await response.json() as unknown; }
    catch {
      reportInvalidUpstreamResponse(
        this.dependencies.logger ?? noopLogger,
        observation,
        response.status,
      );
      throw new QualityControlGatewayError(502, 'invalid-upstream-response');
    }
  }
}

async function handle(
  req: Request,
  res: ExpressResponse,
  dependencies: FmaEndpointDependencies,
  operation: (client: FmaClient) => Promise<unknown>,
): Promise<void> {
  try {
    const userId = await resolveUser(req.header('authorization') ?? '', dependencies, req.path);
    res.status(200).json(await operation(new FmaClient(userId, dependencies)));
  } catch (error) {
    if (error instanceof QualityControlGatewayError) {
      res.status(error.status).json({ code: error.code });
      return;
    }
    res.status(400).json({ code: 'invalid-request' });
  }
}

async function resolveUser(
  header: string,
  dependencies: FmaEndpointDependencies,
  path: string,
): Promise<string> {
  const secret = dependencies.env['APP_AUTH_TOKEN_SECRET'];
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32 || !match) {
    throw new QualityControlGatewayError(401, 'invalid-session');
  }
  let payload: Awaited<ReturnType<typeof verifyAppSessionToken>>;
  try { payload = await verifyAppSessionToken(match[1], secret, dependencies.now?.()); }
  catch { throw new QualityControlGatewayError(401, 'invalid-session'); }
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const permissions = Array.isArray(payload['permissions']) ? payload['permissions'] : [];
  if (!subject) {
    throw new QualityControlGatewayError(403, 'access-denied');
  }
  if (!hasPermissionForPath(path, permissions)) {
    throw new QualityControlGatewayError(403, 'access-denied');
  }
  return subject;
}

function hasPermissionForPath(path: string, permissions: readonly unknown[]): boolean {
  if (path.startsWith('/api/operations')) {
    return permissions.includes(APP_PERMISSIONS.operationReporting);
  }
  if (path.startsWith('/api/production-orders')) {
    return permissions.includes(APP_PERMISSIONS.operationReporting)
      || permissions.includes(APP_PERMISSIONS.batchReporting);
  }
  if (path.startsWith('/api/batches')) return permissions.includes(APP_PERMISSIONS.batchReporting);
  if (path.startsWith('/api/production-stops')) return permissions.includes(APP_PERMISSIONS.stoppages);
  return FMA_PERMISSIONS.some(permission => permissions.includes(permission));
}

function receipt(idempotencyKey: string, serverRecordId: string, current: Date) {
  const now = current.toISOString();
  return { serverRecordId, idempotencyKey, receivedAt: now, processedAt: now, duplicate: false };
}

function dataset(value: unknown, name: string): readonly unknown[] {
  const envelope = objectOf(value);
  const items = envelope['items'];
  if (!Array.isArray(items) || items.length !== 1) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  const rows = objectOf(items[0])[name];
  if (!Array.isArray(rows)) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  return rows;
}

function objectOf(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QualityControlGatewayError(400, 'invalid-request');
  return value as JsonObject;
}
function single(values: readonly unknown[]): unknown {
  if (values.length !== 1) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  return values[0];
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function requiredText(value: unknown): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new QualityControlGatewayError(400, 'invalid-request');
  return result;
}
function optionalText(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function positiveInteger(value: unknown): number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || (number as number) <= 0) throw new QualityControlGatewayError(400, 'invalid-request');
  return number as number;
}
function integerText(value: unknown): string { return String(positiveInteger(value)); }
function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new QualityControlGatewayError(502, 'invalid-upstream-response');
  return value;
}
function isoDate(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new QualityControlGatewayError(400, 'invalid-request');
  return date.toISOString().slice(0, 10);
}
function safeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(value)) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return value;
}
function concretePath(req: Request): string { return req.path; }
function queryObject(req: Request): Record<string, string> {
  return Object.fromEntries(Object.entries(req.query).flatMap(([key, value]) =>
    typeof value === 'string' ? [[key, value]] : []));
}

function operationName(method: string, route: string): string {
  return `fma_${method.toLocaleLowerCase('en-US')}_${route}`
    .replace(/:[^/]+/g, 'resource')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}
