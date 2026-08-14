import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { installAuthLoginEndpoint } from './auth-http-endpoint';
import { installClientLogEndpoint } from './client-log-http-endpoint';
import { installQualityControlEndpoints } from './quality-control-http-endpoint';
import { installFmaEndpoints } from './fma-http-endpoint';
import { createServerLogger } from './server-logger';
import { installServerLifecycle } from './server-lifecycle';
import { requestObservabilityMiddleware, serverErrorHandler } from './server-observability';
import {
  PWA_REVALIDATE_CACHE_CONTROL,
  cacheControlForStaticAsset,
} from './pwa-cache-policy';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();
const logger = createServerLogger(process.env);

app.use(requestObservabilityMiddleware(logger));
installClientLogEndpoint(app, { logger });
installAuthLoginEndpoint(app, { env: process.env, logger });
installQualityControlEndpoints(app, { env: process.env, logger });
installFmaEndpoints(app, { env: process.env, logger });

app.head('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendStatus(204);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: 0,
    index: false,
    redirect: false,
    setHeaders: (response, filePath) => {
      response.setHeader('Cache-Control', cacheControlForStaticAsset(filePath));
    },
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.setHeader('Cache-Control', PWA_REVALIDATE_CACHE_CONTROL);
  }
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});
app.use(serverErrorHandler(logger));

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  const server = app.listen(port, (error) => {
    if (error) {
      throw error;
    }
    logger.info('server_started', {
      port: Number(port) || port,
      logDirectory: logger.config.directory,
    });
  });
  installServerLifecycle(server, logger);
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
