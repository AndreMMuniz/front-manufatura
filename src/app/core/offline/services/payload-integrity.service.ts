import { Inject, Injectable, InjectionToken } from '@angular/core';

import { JsonValue } from '../models/local-record';
import { OfflineStorageError } from '../models/offline-storage-error';

export interface PreparedPayload {
  readonly snapshot: JsonValue;
  readonly canonicalPayload: string;
  readonly payloadHash: string;
}

export type SubtleCryptoProvider = () => SubtleCrypto | undefined;

export const SUBTLE_CRYPTO_PROVIDER = new InjectionToken<SubtleCryptoProvider>(
  'OFFLINE_SUBTLE_CRYPTO_PROVIDER',
  {
    providedIn: 'root',
    factory: () => () => globalThis.crypto?.subtle,
  },
);

const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'senha',
  'credential',
  'credencial',
  'token',
  'authorization',
  'autorizacao',
  'cookie',
  'secret',
  'segredo',
] as const;

const SANITIZED_AUTHORIZATION_METADATA = new Set([
  'authorizationstatus',
  'authorizationresult',
  'supervisorauthorizationid',
]);

@Injectable({ providedIn: 'root' })
export class PayloadIntegrityService {
  constructor(@Inject(SUBTLE_CRYPTO_PROVIDER) private readonly provideSubtle: SubtleCryptoProvider) {}

  async prepare(payload: unknown): Promise<PreparedPayload> {
    const snapshot = canonicalize(payload);
    const canonicalPayload = JSON.stringify(snapshot);
    const payloadHash = await this.hashCanonical(canonicalPayload);
    return deepFreeze({ snapshot, canonicalPayload, payloadHash });
  }

  async hashCanonical(canonicalPayload: string): Promise<string> {
    const subtle = this.provideSubtle();
    if (!subtle || typeof globalThis.TextEncoder !== 'function') {
      throw new OfflineStorageError(
        'CAPABILITY_UNAVAILABLE',
        'SHA-256 não está disponível neste contexto.',
      );
    }

    try {
      const digest = await subtle.digest(
        'SHA-256',
        new globalThis.TextEncoder().encode(canonicalPayload),
      );
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      throw new OfflineStorageError(
        'PAYLOAD_INVALID',
        'Não foi possível calcular a integridade do comando.',
      );
    }
  }
}

function canonicalize(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidPayload();
    }
    return value;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw invalidPayload();
    }
    return value.toISOString();
  }

  if (typeof value !== 'object') {
    throw invalidPayload();
  }

  if (ancestors.has(value)) {
    throw new OfflineStorageError('PAYLOAD_INVALID', 'O payload contém uma referência cíclica.');
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw invalidPayload();
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item, ancestors));
    }

    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      assertSafeKey(key);
      result[key] = canonicalize((value as Record<string, unknown>)[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function assertSafeKey(key: string): void {
  const normalized = key
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

  if (
    !SANITIZED_AUTHORIZATION_METADATA.has(normalized) &&
    SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  ) {
    throw new OfflineStorageError(
      'SENSITIVE_DATA',
      'O payload contém uma categoria de dado que não pode ser persistida.',
    );
  }
}

function invalidPayload(): OfflineStorageError {
  return new OfflineStorageError(
    'PAYLOAD_INVALID',
    'O payload contém um valor não compatível com JSON canônico.',
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
