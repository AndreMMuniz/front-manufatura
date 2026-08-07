import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const browser = resolve('dist/plano-de-controle/browser');
const server = resolve('dist/plano-de-controle/server');
const required = [
  'index.csr.html',
  'manifest.webmanifest',
  'ngsw-worker.js',
  'ngsw.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
];

for (const path of required) {
  if (!existsSync(resolve(browser, path))) {
    throw new Error(`Artefato PWA ausente: ${path}`);
  }
}
if (!existsSync(resolve(server, 'server.mjs'))) {
  throw new Error('Bundle SSR ausente: server/server.mjs');
}

const manifest = JSON.parse(readFileSync(resolve(browser, 'ngsw.json'), 'utf8'));
if ((manifest.dataGroups ?? []).length > 0) {
  throw new Error('O bundle PWA não pode publicar dataGroups nesta story.');
}
if (JSON.stringify(manifest).includes('/api/auth/login')) {
  throw new Error('O login não pode ser cacheado pelo Service Worker.');
}

const files = readdirSync(browser);
if (!files.some(file => /^main-[A-Za-z0-9]+\.js$/.test(file))) {
  throw new Error('Bundle browser com hash não encontrado.');
}

console.log('Artefatos PWA browser+SSR e política sem cache de API validados.');
