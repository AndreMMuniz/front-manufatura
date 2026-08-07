import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = 4301;
const roots = {
  a: resolve('dist/pwa-e2e-a/browser'),
  b: resolve('dist/pwa-e2e-b/browser'),
};
let version = 'a';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
};

const mutablePwaFiles = new Set([
  'index.csr.html',
  'index.html',
  'manifest.webmanifest',
  'ngsw-worker.js',
  'ngsw.json',
  'safety-worker.js',
  'worker-basic.min.js',
]);

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

  if (url.pathname === '/__pwa_test/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(version);
    return;
  }

  const switchMatch = /^\/__pwa_test\/version\/([ab])$/.exec(url.pathname);
  if (request.method === 'POST' && switchMatch) {
    version = switchMatch[1];
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    let input;
    try {
      const body = await readBody(request);
      input = JSON.parse(body || '{}');
    } catch {
      json(response, 400, { code: 'invalid-request' });
      return;
    }
    if (input.login !== 'operador' || input.senha !== 'mock123') {
      json(response, 401, { code: 'invalid-credentials' });
      return;
    }
    json(response, 200, {
      token: 'pwa-e2e-memory-token',
      tokenExpiresAt: new Date(Date.now() + 28_800_000).toISOString(),
      offlineSessionExpiresAt: new Date(Date.now() + 28_800_000).toISOString(),
      usuario: {
        id: 'USR-PWA-E2E',
        nome: 'Operador PWA',
        login: 'operador',
        permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
      },
    });
    return;
  }

  if (
    (request.method === 'GET' || request.method === 'HEAD')
    && url.pathname === '/api/health'
  ) {
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/profile') {
    if (request.headers.authorization !== 'Bearer pwa-e2e-memory-token') {
      json(response, 401, { code: 'unauthorized' });
      return;
    }
    json(response, 200, { id: 'USR-PWA-E2E', displayName: 'Operador PWA' });
    return;
  }

  if (
    url.pathname.startsWith('/api/')
    || (request.method !== 'GET' && request.method !== 'HEAD')
  ) {
    response.writeHead(404);
    response.end();
    return;
  }

  const root = roots[version];
  let relativePath;
  try {
    relativePath = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  const candidate = join(root, relativePath);
  const safeCandidate = candidate.startsWith(`${root}/`) ? candidate : '';
  const candidateExists =
    Boolean(safeCandidate) && existsSync(safeCandidate) && statSync(safeCandidate).isFile();
  if (!candidateExists && extname(relativePath)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const filePath = candidateExists ? safeCandidate : join(root, 'index.csr.html');
  const fileName = filePath.split('/').at(-1) ?? '';
  const cacheControl = mutablePwaFiles.has(fileName)
    ? 'no-cache, max-age=0, must-revalidate'
    : /-[A-Za-z0-9]{8,}\.[A-Za-z0-9]+$/.test(fileName)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600, must-revalidate';

  response.writeHead(200, {
    'Cache-Control': cacheControl,
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
  });
  if (request.method === 'HEAD') {
    response.end();
  } else {
    createReadStream(filePath).pipe(response);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`PWA E2E server listening on http://127.0.0.1:${port}`);
});

function json(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    let rejected = false;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      if (rejected) {
        return;
      }
      body += chunk;
      if (body.length > 16 * 1024) {
        rejected = true;
        reject(new Error('body too large'));
      }
    });
    request.on('end', () => {
      if (!rejected) {
        resolveBody(body);
      }
    });
    request.on('error', reject);
  });
}
