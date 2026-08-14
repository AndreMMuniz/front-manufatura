import { Inject, Injectable, InjectionToken } from '@angular/core';

import { INSECURE_HTTP_TEST_MODE } from '../../runtime/insecure-http-test-mode';
import { OfflineStorageError } from '../models/offline-storage-error';
import { ClientLogService } from '../../logging/client-log.service';

export type RandomUuidCapability = Pick<Crypto, 'randomUUID'>;
export type RandomUuidProvider = () => RandomUuidCapability | undefined;

export const RANDOM_UUID_PROVIDER = new InjectionToken<RandomUuidProvider>(
  'OFFLINE_RANDOM_UUID_PROVIDER',
  {
    providedIn: 'root',
    factory: () => provideBrowserRandomUuid,
  },
);

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable({ providedIn: 'root' })
export class IdempotencyService {
  constructor(
    @Inject(RANDOM_UUID_PROVIDER) private readonly provideCrypto: RandomUuidProvider,
    private readonly clientLogs: ClientLogService = {
      capture: () => undefined,
    } as unknown as ClientLogService,
  ) {}

  resolve(supplied?: string): string {
    if (supplied !== undefined) {
      if (!UUID_V4.test(supplied)) {
        throw new OfflineStorageError(
          'PAYLOAD_INVALID',
          'A chave de idempotência deve ser um UUID v4 válido.',
        );
      }
      return supplied.toLowerCase();
    }

    const cryptoCapability = this.provideCrypto();
    if (!cryptoCapability) {
      this.captureCapabilityUnavailable(false);
      throw new OfflineStorageError(
        'CAPABILITY_UNAVAILABLE',
        'Geração segura de identidade não está disponível neste contexto.',
      );
    }

    const generated = cryptoCapability.randomUUID();
    if (!UUID_V4.test(generated)) {
      this.captureCapabilityUnavailable(true);
      throw new OfflineStorageError(
        'CAPABILITY_UNAVAILABLE',
        'A identidade segura gerada pelo navegador é inválida.',
      );
    }
    return generated.toLowerCase();
  }

  private captureCapabilityUnavailable(available: boolean): void {
    try {
      this.clientLogs.capture({
        level: 'error',
        category: 'capability',
        event: 'identity_capability_unavailable',
        context: {
          cryptoAvailable: available,
          randomUuidAvailable: available,
          insecureHttpTestMode: INSECURE_HTTP_TEST_MODE,
        },
      });
    } catch {
      // Identity semantics must not depend on the diagnostics sink.
    }
  }
}

export function provideBrowserRandomUuid(
  allowInsecureFallback = INSECURE_HTTP_TEST_MODE,
  candidate = globalThis.crypto,
): RandomUuidCapability | undefined {
  if (typeof globalThis.window === 'undefined') {
    return undefined;
  }
  if (typeof candidate?.randomUUID === 'function') {
    return candidate;
  }
  if (!allowInsecureFallback || typeof candidate?.getRandomValues !== 'function') {
    return undefined;
  }
  return {
    randomUUID: () => uuidV4FromRandomValues(candidate) as ReturnType<Crypto['randomUUID']>,
  };
}

export function uuidV4FromRandomValues(crypto: Pick<Crypto, 'getRandomValues'>): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
