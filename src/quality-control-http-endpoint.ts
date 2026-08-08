import express, {
  type Application,
  type ErrorRequestHandler,
  type Request,
  type Response,
} from 'express';

import { verifyAppSessionToken } from './app-session-token';
import {
  QualityControlDatasulClient,
  QualityControlGatewayError,
  readQualityControlDatasulConfig,
  type QualityControlEnvironment,
  type QualityControlTransport,
} from './quality-control-datasul-client';

const ROOT = '/api/quality-control';

export interface QualityControlEndpointDependencies {
  readonly env: QualityControlEnvironment;
  readonly transport?: QualityControlTransport;
  readonly timeoutSignal?: (timeoutMs: number) => AbortSignal;
  readonly now?: () => Date;
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

  installMethodGuard(app, `${ROOT}/orders/:orderNumber`, 'GET');
  installMethodGuard(app, `${ROOT}/routes`, 'POST');
  installMethodGuard(app, `${ROOT}/results`, 'PUT');
  installMethodGuard(app, `${ROOT}/routes/finalize`, 'PUT');

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
  if (hasResult === hasCompleteOption || hasTableNumber !== hasOptionSequence) {
    throw new QualityControlGatewayError(400, 'invalid-request');
  }
  if (hasResult) {
    return { ...common, resultado: finiteNumber(body['resultado']) };
  }
  return {
    ...common,
    nrTabela: positiveInteger(body['nrTabela']),
    seqOpcao: positiveInteger(body['seqOpcao']),
  };
}

async function handle(
  req: Request,
  res: Response,
  dependencies: QualityControlEndpointDependencies,
  operation: (client: QualityControlDatasulClient, userId: string) => Promise<unknown>,
): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const subject = await resolveQualityControlUserId(
      header,
      dependencies.env,
      dependencies.now?.(),
    );
    const config = readQualityControlDatasulConfig(dependencies.env);
    const client = new QualityControlDatasulClient(
      config,
      dependencies.transport,
      dependencies.timeoutSignal,
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
): Promise<string> {
  const secret = env['APP_AUTH_TOKEN_SECRET'];
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new QualityControlGatewayError(503, 'quality-control-gateway-not-configured');
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) throw new QualityControlGatewayError(401, 'invalid-session');
  try {
    const payload = await verifyAppSessionToken(match[1], secret, now);
    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (
      !subject
      || subject.length > 256
      || subject.includes(':')
      || /[\u0000-\u001f\u007f]/u.test(subject)
    ) throw new Error('invalid-subject');
    return subject;
  } catch {
    throw new QualityControlGatewayError(401, 'invalid-session');
  }
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
