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
        ...routeResponsible(body),
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
    await handle(req, res, dependencies, async (client, userId) => {
      const order = req.query['nrOrdemProducao'];
      const operation = req.query['opCodigo'];
      if (order === undefined && operation === undefined) {
        return client.getRoutesPendingAuthorization({ codUsuario: userId });
      }
      return client.getRoutesPendingAuthorization({
        nrOrdemProducao: positiveInteger(order),
        opCodigo: positiveInteger(operation),
        codUsuario: userId,
      });
    }, APP_PERMISSIONS.divergentRouteAuthorization);
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
      const operationCode = await authorizedOperationCode(client, body, orderNumber);
      const pending = await client.getPendingRoute({
        nrFicha: expectedSheetNumber,
        codUsuario: userId,
      });
      return selectPendingRouteEnvelope(pending, expectedSheetNumber, orderNumber, operationCode);
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
  const hasMaximumResult = body['resultadoMax'] !== undefined;
  const hasTableNumber = body['nrTabela'] !== undefined;
  const hasOptionSequence = body['seqOpcao'] !== undefined;
  const hasCompleteOption = hasTableNumber && hasOptionSequence;
  const report = typeof body['laudo'] === 'string' ? body['laudo'].trim() : '';
  if (
    hasTableNumber !== hasOptionSequence
    || (hasMaximumResult && !hasResult)
    || [hasResult, hasCompleteOption, Boolean(report)].filter(Boolean).length !== 1
  ) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  if (hasResult) {
    return {
      ...common,
      resultado: finiteNumber(body['resultado']),
      ...(hasMaximumResult ? { resultadoMax: finiteNumber(body['resultadoMax']) } : {}),
    };
  }
  if (report) return { ...common, laudo: report };
  return {
    ...common,
    nrTabela: positiveInteger(body['nrTabela']),
    seqOpcao: positiveInteger(body['seqOpcao']),
  };
}

function selectPendingRouteEnvelope(
  value: unknown,
  expectedSheetNumber: number,
  expectedOrderNumber: number,
  operationCode: number,
): JsonObject {
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
  const dataset = upstreamObject(item['ds-roteiro-pendente']);
  if (!Array.isArray(dataset['roteiro'])) throw invalidUpstream();
  const matches = dataset['roteiro']
    .map(upstreamObject)
    .filter(route => route['nrFicha'] === expectedSheetNumber && route['nrOrdemProducao'] === expectedOrderNumber);
  if (matches.length !== 1) throw invalidUpstream();
  const pendingRoute = matches[0];
  const expectedComponents = upstreamNonNegativeInteger(pendingRoute['componentesTotal']);
  if (!Array.isArray(pendingRoute['resultados']) || pendingRoute['resultados'].length !== expectedComponents) {
    throw invalidUpstream();
  }
  const results = pendingRoute['resultados'].map(upstreamObject);
  const componentIdentities = new Set<string>();
  const exams = new Map<number, JsonObject[]>();
  for (const result of results) {
    if (result['nrFicha'] !== expectedSheetNumber) throw invalidUpstream();
    const examCode = upstreamPositiveInteger(result['codExame']);
    const componentCode = upstreamPositiveInteger(result['codComponente']);
    const identity = `${examCode}:${componentCode}`;
    if (componentIdentities.has(identity)) throw invalidUpstream();
    componentIdentities.add(identity);
    const minValue = upstreamFiniteNumber(result['resultadoMinDefinido']);
    const maxValue = upstreamFiniteNumber(result['resultadoMaxDefinido']);
    const resultType = upstreamPositiveInteger(result['tipoResultado']);
    const tableNumber = upstreamNonNegativeInteger(result['nrTabela']);
    const resultOptions = pendingResultOptions(result, examCode, componentCode, tableNumber);
    const components = exams.get(examCode) ?? [];
    components.push({
      codExame: examCode,
      codComponente: componentCode,
      descricao: `COMPONENTE ${componentCode}`,
      referenciaTecnica: '',
      metodo: '',
      equipamento: '',
      tipoResultado: resultType,
      unidade: '',
      numeroDecimais: 6,
      resultadoMin: minValue,
      resultadoMax: maxValue,
      nrTabela: tableNumber,
      ...(resultOptions === undefined ? {} : { opcoesResultado: resultOptions }),
    });
    exams.set(examCode, components);
  }
  return {
    total: 1,
    hasNext: false,
    items: [{
      nrFicha: expectedSheetNumber,
      codOperacao: operationCode,
      'ds-roteiro': {
        exames: [...exams.entries()].map(([examCode, components]) => ({
          codExame: examCode,
          descricao: `EXAME ${examCode}`,
          versao: 1,
          frequencia: 0,
          amostra: 1,
          nivel: 0,
          nqa: 0,
          responsavel: '',
          observacao: '',
          componentes: components,
        })),
      },
    }],
  };
}

function pendingResultOptions(
  result: JsonObject,
  expectedExamCode: number,
  expectedComponentCode: number,
  expectedTableNumber: number,
): JsonObject[] | undefined {
  if (result['opcoesResultado'] === undefined) return undefined;
  if (!Array.isArray(result['opcoesResultado'])) throw invalidUpstream();
  const sequences = new Set<number>();
  return result['opcoesResultado'].map(value => {
    const option = upstreamObject(value);
    const tableNumber = upstreamPositiveInteger(option['nrTabela']);
    const sequence = upstreamPositiveInteger(option['seqOpcao']);
    if (
      tableNumber !== expectedTableNumber
      || upstreamPositiveInteger(option['codComponente']) !== expectedComponentCode
      || upstreamPositiveInteger(option['codExame']) !== expectedExamCode
      || sequences.has(sequence)
      || typeof option['descricao'] !== 'string'
      || !option['descricao'].trim()
    ) throw invalidUpstream();
    sequences.add(sequence);
    return {
      nrTabela: tableNumber,
      seqOpcao: sequence,
      codComponente: expectedComponentCode,
      codExame: expectedExamCode,
      descricao: option['descricao'],
    };
  });
}

async function authorizedOperationCode(
  client: QualityControlDatasulClient,
  body: JsonObject,
  expectedOrderNumber: number,
): Promise<number> {
  const hasOperationCode = body['codOperacao'] !== undefined;
  const hasOperationSequence = body['sequenciaOperacao'] !== undefined;
  if (hasOperationCode === hasOperationSequence) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  if (hasOperationCode) return positiveInteger(body['codOperacao']);

  const expectedSequence = positiveInteger(body['sequenciaOperacao']);
  const envelope = upstreamObject(await client.getOrder(expectedOrderNumber));
  if (!Array.isArray(envelope['items'])) throw invalidUpstream();
  const matches = envelope['items'].flatMap(itemValue => {
    const dataset = upstreamObject(upstreamObject(itemValue)['ds-ordem-producao']);
    if (!Array.isArray(dataset['ordem'])) throw invalidUpstream();
    return dataset['ordem'].flatMap(orderValue => {
      const order = upstreamObject(orderValue);
      if (order['nrOrdemProducao'] !== expectedOrderNumber) return [];
      if (!Array.isArray(order['operacoes'])) throw invalidUpstream();
      return order['operacoes']
        .map(upstreamObject)
        .filter(operation => operation['sequencia'] === expectedSequence)
        .map(operation => upstreamPositiveInteger(operation['codOperacao']));
    });
  });
  if (matches.length !== 1) throw invalidUpstream();
  return matches[0];
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
      res.status(error.status).json({
        code: error.code,
        ...(error.publicMessage ? { message: error.publicMessage } : {}),
      });
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

function routeResponsible(body: JsonObject): { codOperador: string } | { codEquipe: string } {
  const hasOperator = body['codOperador'] !== undefined;
  const hasTeam = body['codEquipe'] !== undefined;
  if (hasOperator === hasTeam) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  const field = hasOperator ? 'codOperador' : 'codEquipe';
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  return field === 'codOperador'
    ? { codOperador: value.trim() }
    : { codEquipe: value.trim() };
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

function upstreamFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidUpstream();
  return value;
}

function invalidUpstream(): QualityControlGatewayError {
  return new QualityControlGatewayError(502, 'invalid-upstream-response');
}
