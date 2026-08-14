import express, {
  type Application,
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';

import {
  AuthLoginError,
  authenticateExternalLogin,
  type AuthenticatedLogin,
  type LoginEnvironment,
  type LoginInput,
} from './auth-login';
import type { ApplicationLogger } from './logging/log-contracts';

const LOGIN_PATH = '/api/auth/login';

export interface AuthLoginEndpointDependencies {
  env: LoginEnvironment;
  authenticate?: (
    input: LoginInput,
    env: LoginEnvironment,
  ) => Promise<AuthenticatedLogin>;
  logger?: ApplicationLogger;
  clock?: () => number;
}

function isBodyObject(value: unknown): value is LoginInput {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function installAuthLoginEndpoint(
  app: Application,
  dependencies: AuthLoginEndpointDependencies,
): void {
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  app.use(LOGIN_PATH, noStore);

  app.all(LOGIN_PATH, (req, res, next) => {
    if (req.method === 'POST') {
      next();
      return;
    }
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method-not-allowed' });
  });

  app.use(LOGIN_PATH, express.json({ limit: '16kb' }));
  app.post(LOGIN_PATH, async (req, res) => {
    if (!isBodyObject(req.body)) {
      res.status(400).json({ code: 'invalid-request' });
      return;
    }

    try {
      const result = dependencies.authenticate
        ? await dependencies.authenticate(req.body, dependencies.env)
        : await authenticateExternalLogin(req.body, dependencies.env, {
          logger: dependencies.logger,
          clock: dependencies.clock,
        });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AuthLoginError) {
        res.status(error.status).json({ code: error.code });
        return;
      }
      res.status(502).json({ code: 'datasul-unavailable' });
    }
  });

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
  app.use(LOGIN_PATH, sanitizedParserError);
}
