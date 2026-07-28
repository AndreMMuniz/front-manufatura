import { describe, expect, it, vi } from 'vitest';

import { OfflineStorageError } from '../models/offline-storage-error';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  it('gera UUID v4 com Web Crypto uma única vez', () => {
    const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000' as `${string}-${string}-${string}-${string}-${string}`);
    const service = new IdempotencyService(() => ({ randomUUID }));

    expect(service.resolve()).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('preserva uma identidade fornecida válida sem regenerá-la', () => {
    const randomUUID = vi.fn();
    const service = new IdempotencyService(() => ({ randomUUID }));
    const supplied = '123E4567-E89B-42D3-A456-426614174000';

    expect(service.resolve(supplied)).toBe(supplied);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('rejeita identidade inválida e indisponibilidade de Web Crypto', () => {
    const service = new IdempotencyService(() => undefined);

    expect(() => service.resolve('command-1')).toThrowError(OfflineStorageError);
    expect(() => service.resolve()).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });
});
