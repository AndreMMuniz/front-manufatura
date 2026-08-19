import express, {
  type Application,
  type ErrorRequestHandler,
  type Request,
  type Response,
} from 'express';

import { verifyAppSessionToken } from './app-session-token';
import { APP_PERMISSIONS, type AppPermission } from './app-permissions';
import {
  QualityControlDatasulClient,
  QualityControlGatewayError,
  readQualityControlDatasulConfig,
  type QualityControlEnvironment,
  type QualityControlTransport,
} from './quality-control-datasul-client';
import type { ApplicationLogger } from './logging/log-contracts';

const ROOT = '/api/quality-control';

export interface QualityControlEndpointDependencies {
  readonly env: QualityControlEnvironment;
  readonly transport?: QualityControlTransport;
  readonly timeoutSignal?: (timeoutMs: number) => AbortSignal;
  readonly now?: () => Date;
  readonly logger?: ApplicationLogger;
  readonly clock?: () => number;
}

type JsonObject = Record<string, unknown>;

export function installQualityControlEndpoints(
  app: Application,
  dependencies: QualityControlEndpointDependencies,
): void {
  app.use(ROOT, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(ROOT, express.json({ limit: '32kb' }));

  app.get(`${ROOT}/orders/:orderNumber`, async (req, res) => {
    await handle(req, res, dependencies, async client => {
      const orderNumber = positiveInteger(req.params['orderNumber']);
      return client.getOrder(orderNumber);
    });
  });

  app.post(`${ROOT}/routes`, async (req, res) => {
    await handle(req, res, dependencies, async client => {
      const body = objectBody(req.body);
      return client.getRoute({
        nrOrdemProducao: positiveInteger(body['nrOrdemProducao']),
        codOperacao: positiveInteger(body['codOperacao']),
      });
    });
  });

  app.put(`${ROOT}/results`, async (req, res) => {
    await handle(req, res, dependencies, async (client, userId) => {
      const body = objectBody(req.body);
      return client.saveResult(buildQualityResultPayload(body, userId));
    });
  });

  app.put(`${ROOT}/routes/finalize`, async (req, res) => {
    await handle(req, res, dependencies, async (client, userId) => {
      const body = objectBody(req.body);
      return client.finalizeRoute({
        nrFicha: positiveInteger(body['nrFicha']),
        codUsuario: userId,
      });
    });
  });

  app.get(`${ROOT}/route-authorizations`, async (req, res) => {
    await handle(req, res, dependencies, async (client, userId) =>
      client.getRoutesPendingAuthorization({
        nrOrdemProducao: positiveInteger(req.query['nrOrdemProducao']),
        opCodigo: positiveInteger(req.query['opCodigo']),
        codUsuario: userId,
      }), APP_PERMISSIONS.divergentRouteAuthorization);
  });

  app.post(`${ROOT}/route-authorizations/finalize`, async (req, res) => {
    await handle(req, res, dependencies, async (client, userId) => {
      const body = objectBody(req.body);
      return client.finalizeRouteWithAuthorization({
        nrFicha: positiveInteger(body['nrFicha']),
        codUsuario: userId,
      });
    }, APP_PERMISSIONS.divergentRouteAuthorization);
  });

  app.post(`${ROOT}/route-authorizations/route`, async (req, res) => {
    await handle(req, res, dependencies, async (client, userId) => {
      const body = objectBody(req.body);
      const expectedSheetNumber = positiveInteger(body['nrFicha']);
      const orderNumber = positiveInteger(body['nrOrdemProducao']);
      const operationCode = positiveInteger(body['codOperacao']);
      const pending = await client.getRoutesPendingAuthorization({
        nrOrdemProducao: orderNumber,
        opCodigo: operationCode,
        codUsuario: userId,
      });
      assertPendingAuthorizedRoute(pending, expectedSheetNumber, orderNumber);
      const upstream = await client.getRoute({
        nrOrdemProducao: orderNumber,
        codOperacao: operationCode,
      });
      return selectAuthorizedRouteEnvelope(upstream, expectedSheetNumber);
    }, APP_PERMISSIONS.divergentRouteAuthorization);
  });

  app.put(`${ROOT}/route-authorizations/results`, async (req, res) => {
    await handle(req, res, dependencies, (client, userId) =>
      client.saveResult(buildQualityResultPayload(objectBody(req.body), userId)),
    APP_PERMISSIONS.divergentRouteAuthorization);
  });

  installMethodGuard(app, `${ROOT}/orders/:orderNumber`, 'GET');
  installMethodGuard(app, `${ROOT}/routes`, 'POST');
  installMethodGuard(app, `${ROOT}/results`, 'PUT');
  installMethodGuard(app, `${ROOT}/routes/finalize`, 'PUT');
  installMethodGuard(app, `${ROOT}/route-authorizations`, 'GET');
  installMethodGuard(app, `${ROOT}/route-authorizations/finalize`, 'POST');
  installMethodGuard(app, `${ROOT}/route-authorizations/route`, 'POST');
  installMethodGuard(app, `${ROOT}/route-authorizations/results`, 'PUT');

  const sanitizedParserError: ErrorRequestHandler = (error, _req, res, next) => {
    const candidate = typeof error === 'object' && error !== null
      ? error as { status?: unknown; type?: unknown }
      : {};
    if (candidate.status === 413 || candidate.type === 'entity.too.large') {
      res.status(413).json({ code: 'request-too-large' });
      return;
    }
    if (candidate.status === 400 || candidate.type === 'entity.parse.failed') {
      res.status(400).json({ code: 'invalid-request' });
      return;
    }
    next(error);
  };
  app.use(ROOT, sanitizedParserError);
  app.use(ROOT, (_req, res) => {
    res.status(404).json({ code: 'not-found' });
  });
}

export function buildQualityResultPayload(
  body: Readonly<Record<string, unknown>>,
  userId: string,
): Record<string, number | string> {
  const common = {
    nrFicha: positiveInteger(body['nrFicha']),
    codExame: positiveInteger(body['codExame']),
    codComponente: positiveInteger(body['codComponente']),
    codUsuario: userId,
  };
  const hasResult = body['resultado'] !== undefined;
  const hasTableNumber = body['nrTabela'] !== undefined;
  const hasOptionSequence = body['seqOpcao'] !== undefined;
  const hasCompleteOption = hasTableNumber && hasOptionSequence;
  const report = typeof body['laudo'] === 'string' ? body['laudo'].trim() : '';
  if (
    hasTableNumber !== hasOptionSequence
    || [hasResult, hasCompleteOption, Boolean(report)].filter(Boolean).length !== 1
  ) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  if (hasResult) {
    return { ...common, resultado: finiteNumber(body['resultado']) };
  }
  if (report) return { ...common, laudo: report };
  return {
    ...common,
    nrTabela: positiveInteger(body['nrTabela']),
    seqOpcao: positiveInteger(body['seqOpcao']),
  };
}

function selectAuthorizedRouteEnvelope(value: unknown, expectedSheetNumber: number): JsonObject {
  const envelope = upstreamObject(value);
  const total = upstreamNonNegativeInteger(envelope['total']);
  if (
    envelope['hasNext'] !== false
    || !Array.isArray(envelope['items'])
    || total !== 1
    || envelope['items'].length !== 1
  ) {
    throw invalidUpstream();
  }
  const item = upstreamObject(envelope['items'][0]);
  upstreamPositiveInteger(item['nrFicha']);
  upstreamObject(item['ds-roteiro']);
  return { total: 1, hasNext: false, items: [{ ...item, nrFicha: expectedSheetNumber }] };
}

function assertPendingAuthorizedRoute(value: unknown, expectedSheetNumber: number, expectedOrderNumber: number): void {
  const envelope = upstreamObject(value);
  if (!Array.isArray(envelope['items'])) throw invalidUpstream();
  const matches = envelope['items'].flatMap(itemValue => {
    const item = upstreamObject(itemValue);
    const dataset = item['ds-autorizacao'] === undefined ? item : upstreamObject(item['ds-autorizacao']);
    if (dataset['roteirosEmAnalise'] === undefined) return [];
    if (!Array.isArray(dataset['roteirosEmAnalise'])) throw invalidUpstream();
    return dataset['roteirosEmAnalise']
      .map(upstreamObject)
      .filter(route => route['nrFicha'] === expectedSheetNumber && route['nrOrdemProducao'] === expectedOrderNumber);
  });
  if (matches.length !== 1) throw invalidUpstream();
}

async function handle(
  req: Request,
  res: Response,
  dependencies: QualityControlEndpointDependencies,
  operation: (client: QualityControlDatasulClient, userId: string) => Promise<unknown>,
  requiredPermission: AppPermission = APP_PERMISSIONS.qualityControl,
): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const subject = await resolveQualityControlUserId(
      header,
      dependencies.env,
      dependencies.now?.(),
      requiredPermission,
    );
    const config = readQualityControlDatasulConfig(dependencies.env);
    const client = new QualityControlDatasulClient(
      config,
      dependencies.transport,
      dependencies.timeoutSignal,
      dependencies.logger,
      dependencies.clock,
    );
    res.status(200).json(await operation(client, subject));
  } catch (error) {
    if (error instanceof QualityControlGatewayError) {
      res.status(error.status).json({ code: error.code });
      return;
    }
    res.status(400).json({ code: 'invalid-request' });
  }
}

export async function resolveQualityControlUserId(
  authorization: string,
  env: QualityControlEnvironment,
  now?: Date,
  requiredPermission: AppPermission = APP_PERMISSIONS.qualityControl,
): Promise<string> {
  const secret = env['APP_AUTH_TOKEN_SECRET'];
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new QualityControlGatewayError(503, 'quality-control-gateway-not-configured');
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) throw new QualityControlGatewayError(401, 'invalid-session');
  let payload: Awaited<ReturnType<typeof verifyAppSessionToken>>;
  try {
    payload = await verifyAppSessionToken(match[1], secret, now);
  } catch {
    throw new QualityControlGatewayError(401, 'invalid-session');
  }
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (
    !subject
    || subject.length > 256
    || subject.includes(':')
    || /[\u0000-\u001f\u007f]/u.test(subject)
  ) throw new QualityControlGatewayError(401, 'invalid-session');
  if (!Array.isArray(payload['permissions'])
    || !payload['permissions'].every(permission => typeof permission === 'string')) {
    throw new QualityControlGatewayError(401, 'invalid-session');
  }
  if (!payload['permissions'].includes(requiredPermission)) {
    throw new QualityControlGatewayError(403, 'access-denied');
  }
  return subject;
}

function installMethodGuard(app: Application, path: string, allow: string): void {
  app.all(path, (_req, res) => {
    res.setHeader('Allow', allow);
    res.status(405).json({ code: 'method-not-allowed' });
  });
}

function objectBody(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return value as JsonObject;
}

function positiveInteger(value: unknown): number {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || (numeric as number) <= 0) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return numeric as number;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return value;
}

function upstreamObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidUpstream();
  return value as JsonObject;
}

function upstreamNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidUpstream();
  return value as number;
}

function upstreamPositiveInteger(value: unknown): number {
  const result = upstreamNonNegativeInteger(value);
  if (result === 0) throw invalidUpstream();
  return result;
}

function invalidUpstream(): QualityControlGatewayError {
  return new QualityControlGatewayError(502, 'invalid-upstream-response');
}
