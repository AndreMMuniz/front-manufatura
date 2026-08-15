import { describe, expect, it, vi } from 'vitest';

import { OfflineStorageError } from '../models/offline-storage-error';
import { IdempotencyService, provideBrowserRandomUuid } from './idempotency.service';

describe('IdempotencyService', () => {
  it('gera UUID v4 com Web Crypto uma única vez', () => {
    const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000' as `${string}-${string}-${string}-${string}-${string}`);
    const service = new IdempotencyService(() => ({ randomUUID }));

    expect(service.resolve()).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('canonicaliza uma identidade fornecida válida sem regenerá-la', () => {
    const randomUUID = vi.fn();
    const service = new IdempotencyService(() => ({ randomUUID }));
    const supplied = '123E4567-E89B-42D3-A456-426614174000';

    expect(service.resolve(supplied)).toBe(supplied.toLowerCase());
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('rejeita identidade inválida e indisponibilidade de Web Crypto', () => {
    const capture = vi.fn();
    const service = new IdempotencyService(() => undefined, { capture } as never);

    expect(() => service.resolve('command-1')).toThrowError(OfflineStorageError);
    expect(() => service.resolve()).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith({
      level: 'error', category: 'capability', event: 'identity_capability_unavailable',
      context: {
        cryptoAvailable: false, randomUuidAvailable: false, insecureHttpTestMode: false,
      },
    });
  });

  it('registra UUID inseguro e preserva o mesmo erro quando o sink lança', () => {
    const capture = vi.fn(() => { throw new Error('sink'); });
    const service = new IdempotencyService(
      () => ({ randomUUID: () => 'invalid' as `${string}-${string}-${string}-${string}-${string}` }),
      { capture } as never,
    );

    expect(() => service.resolve()).toThrowError(expect.objectContaining({
      code: 'CAPABILITY_UNAVAILABLE',
      message: 'A identidade segura gerada pelo navegador é inválida.',
    }));
    expect(capture).toHaveBeenCalledOnce();
  });

  it.each([
    ['provedor', () => { throw new Error('crypto bloqueado'); }],
    ['randomUUID', () => ({ randomUUID: () => { throw new Error('uuid bloqueado'); } })],
  ])('normaliza exceção do %s como indisponibilidade diagnosticada', (_case, provider) => {
    const capture = vi.fn();
    const service = new IdempotencyService(provider as never, { capture } as never);

    expect(() => service.resolve()).toThrowError(expect.objectContaining({
      code: 'CAPABILITY_UNAVAILABLE',
    }));
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      event: 'identity_capability_unavailable',
    }));
  });

  it('não expõe Web Crypto quando window não existe no SSR', () => {
    vi.stubGlobal('window', undefined);

    expect(provideBrowserRandomUuid()).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('gera UUID v4 por getRandomValues apenas no modo HTTP temporário', () => {
    const candidate = {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        return bytes;
      }),
    } as unknown as Crypto;

    const capability = provideBrowserRandomUuid(true, candidate);

    expect(capability?.randomUUID()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('não habilita fallback inseguro no build normal', () => {
    const candidate = { getRandomValues: vi.fn() } as unknown as Crypto;

    expect(provideBrowserRandomUuid(false, candidate)).toBeUndefined();
  });
});
