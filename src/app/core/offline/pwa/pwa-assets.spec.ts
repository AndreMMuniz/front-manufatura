import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T;
}

describe('configuração dos artefatos PWA', () => {
  it('mantém o Service Worker na linha Angular 21.2 e somente no build de produção', () => {
    const packageJson = readJson<{
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    }>('package.json');
    const angular = readJson<{
      projects: {
        'plano-de-controle': {
          architect: {
            build: {
              configurations: Record<string, {
                serviceWorker?: string;
                fileReplacements?: Array<{ replace: string; with: string }>;
              }>;
            };
          };
        };
      };
    }>('angular.json');
    const configurations = angular.projects['plano-de-controle'].architect.build.configurations;

    expect(packageJson.dependencies['@angular/service-worker']).toMatch(/^~21\.2\./);
    expect(configurations['production'].serviceWorker).toBe('ngsw-config.json');
    expect(configurations['development'].serviceWorker).toBeUndefined();
    expect(configurations['e2e'].serviceWorker).toBeUndefined();
    expect(packageJson.scripts['build:http-test'])
      .toBe('ng build --configuration http-test');
    expect(configurations['http-test'].serviceWorker).toBeUndefined();
    expect(configurations['http-test'].fileReplacements).toContainEqual({
      replace: 'src/app/core/runtime/insecure-http-test-mode.ts',
      with: 'src/app/core/runtime/insecure-http-test-mode.http-test.ts',
    });
  });

  it('faz prefetch somente do shell e de assets essenciais, sem cache de API', () => {
    const config = readJson<{
      index: string;
      assetGroups: Array<{
        name: string;
        installMode: string;
        resources: { files: Array<string> };
      }>;
      dataGroups?: Array<{ urls: Array<string> }>;
      navigationUrls: Array<string>;
    }>('ngsw-config.json');
    const files = config.assetGroups.flatMap(group => group.resources.files);

    expect(config.index).toBe('/index.csr.html');
    expect(config.assetGroups.every(group => group.installMode === 'prefetch')).toBe(true);
    expect(files).toEqual(expect.arrayContaining([
      '/index.csr.html',
      '/*.css',
      '/*.js',
      '/favicon.ico',
      '/manifest.webmanifest',
      '/assets/logo-cortag.png',
      '/icons/*.png',
      '/media/**',
    ]));
    expect(config.dataGroups ?? []).toEqual([]);
    expect(config.navigationUrls).toContain('!/api/**');
  });

  it('publica manifesto, ícones e metadados coerentes no documento', () => {
    const manifest = readJson<{
      lang: string;
      theme_color: string;
      icons: Array<{ src: string; sizes: string }>;
    }>('public/manifest.webmanifest');
    const indexHtml = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');

    expect(manifest.lang).toBe('pt-BR');
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(indexHtml).toContain('<html lang="pt-BR">');
    expect(indexHtml).toContain('rel="manifest" href="manifest.webmanifest"');
    expect(indexHtml).toContain(`name="theme-color" content="${manifest.theme_color}"`);
  });
});
