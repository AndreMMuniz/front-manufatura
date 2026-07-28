import { Inject, Injectable, InjectionToken } from '@angular/core';

import { OfflineStorageError } from '../models/offline-storage-error';

export type RandomUuidCapability = Pick<Crypto, 'randomUUID'>;
export type RandomUuidProvider = () => RandomUuidCapability | undefined;

export const RANDOM_UUID_PROVIDER = new InjectionToken<RandomUuidProvider>(
  'OFFLINE_RANDOM_UUID_PROVIDER',
  {
    providedIn: 'root',
    factory: () => () => {
      const candidate = globalThis.crypto;
      return typeof candidate?.randomUUID === 'function' ? candidate : undefined;
    },
  },
);

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable({ providedIn: 'root' })
export class IdempotencyService {
  constructor(@Inject(RANDOM_UUID_PROVIDER) private readonly provideCrypto: RandomUuidProvider) {}

  resolve(supplied?: string): string {
    if (supplied !== undefined) {
      if (!UUID_V4.test(supplied)) {
        throw new OfflineStorageError(
          'PAYLOAD_INVALID',
          'A chave de idempotência deve ser um UUID v4 válido.',
        );
      }
      return supplied;
    }

    const cryptoCapability = this.provideCrypto();
    if (!cryptoCapability) {
      throw new OfflineStorageError(
        'CAPABILITY_UNAVAILABLE',
        'Geração segura de identidade não está disponível neste contexto.',
      );
    }

    const generated = cryptoCapability.randomUUID();
    if (!UUID_V4.test(generated)) {
      throw new OfflineStorageError(
        'CAPABILITY_UNAVAILABLE',
        'A identidade segura gerada pelo navegador é inválida.',
      );
    }
    return generated;
  }
}
