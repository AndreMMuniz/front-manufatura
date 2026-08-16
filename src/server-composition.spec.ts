// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('server composition', () => {
  it('instala coleta após observabilidade e antes dos demais endpoints/SSR', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');
    const observability = source.indexOf('app.use(requestObservabilityMiddleware(logger))');
    const clientLogs = source.indexOf('installClientLogEndpoint(app, { logger })');
    const auth = source.indexOf('installAuthLoginEndpoint(app, { env: process.env, logger })');
    const staticFiles = source.indexOf('express.static(browserDistFolder');

    expect(observability).toBeGreaterThan(-1);
    expect(clientLogs).toBeGreaterThan(observability);
    expect(auth).toBeGreaterThan(clientLogs);
    expect(staticFiles).toBeGreaterThan(auth);
    expect(source).toContain('installQualityControlEndpoints');
    expect(source).toContain('installFmaEndpoints');
    expect(source).toContain("app.head('/api/health'");
    expect(source).toContain('app.use(serverErrorHandler(logger))');
    expect(source).toContain('export const reqHandler = createNodeRequestHandler(app)');
  });
});
