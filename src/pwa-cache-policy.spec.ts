import { describe, expect, it } from 'vitest';

import { cacheControlForStaticAsset, PWA_REVALIDATE_CACHE_CONTROL } from './pwa-cache-policy';

describe('política HTTP dos artefatos PWA', () => {
  it.each([
    '/index.html',
    '/index.csr.html',
    '/ngsw.json',
    '/ngsw-worker.js',
    '/safety-worker.js',
    '/worker-basic.min.js',
    '/manifest.webmanifest',
  ])('exige revalidação para %s', (path) => {
    expect(cacheControlForStaticAsset(path)).toBe(PWA_REVALIDATE_CACHE_CONTROL);
  });

  it.each([
    '/main-A7DXZSV4.js',
    '/styles-ZIZFMSPB.css',
    '/media/Roboto-Regular-7OAIQAAR.ttf',
  ])('mantém cache imutável longo somente para asset com hash: %s', (path) => {
    expect(cacheControlForStaticAsset(path)).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('usa cache curto revalidável para asset estático sem hash', () => {
    expect(cacheControlForStaticAsset('/assets/logo-cortag.png')).toBe(
      'public, max-age=3600, must-revalidate',
    );
  });
});
