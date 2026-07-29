export const PWA_REVALIDATE_CACHE_CONTROL = 'no-cache, max-age=0, must-revalidate';

const PWA_MUTABLE_FILES = new Set([
  'index.html',
  'index.csr.html',
  'ngsw.json',
  'ngsw-worker.js',
  'safety-worker.js',
  'worker-basic.min.js',
  'manifest.webmanifest',
]);

const HASHED_ASSET = /-[A-Za-z0-9]{8,}\.[A-Za-z0-9]+$/;

export function cacheControlForStaticAsset(path: string): string {
  const fileName = path.split(/[\\/]/).at(-1) ?? '';

  if (PWA_MUTABLE_FILES.has(fileName)) {
    return PWA_REVALIDATE_CACHE_CONTROL;
  }

  if (HASHED_ASSET.test(fileName)) {
    return 'public, max-age=31536000, immutable';
  }

  return 'public, max-age=3600, must-revalidate';
}
