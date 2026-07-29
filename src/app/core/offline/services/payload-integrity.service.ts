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
    factory: () => provideBrowserSubtleCrypto,
  },
);

const MAX_PAYLOAD_DEPTH = 100;

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

const SENSITIVE_EXACT_KEYS = new Set([
  'apikey',
  'accesskey',
  'clientkey',
  'privatekey',
  'jwt',
  'supervisorpin',
]);

const SANITIZED_AUTHORIZATION_METADATA = new Set([
  'authorizationstatus',
  'authorizationresult',
  'supervisorauthorizationid',
]);

@Injectable({ providedIn: 'root' })
export class PayloadIntegrityService {
  constructor(@Inject(SUBTLE_CRYPTO_PROVIDER) private readonly provideSubtle: SubtleCryptoProvider) {}

  async prepare(payload: unknown): Promise<PreparedPayload> {
    let snapshot: JsonValue;
    try {
      snapshot = canonicalize(payload);
    } catch (error) {
      if (error instanceof OfflineStorageError) {
        throw error;
      }
      throw invalidPayload();
    }
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

export function provideBrowserSubtleCrypto(): SubtleCrypto | undefined {
  if (typeof globalThis.window === 'undefined') {
    return undefined;
  }
  return globalThis.crypto?.subtle;
}

function canonicalize(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): JsonValue {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw invalidPayload();
  }

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
    if (Number.isNaN(Date.prototype.getTime.call(value))) {
      throw invalidPayload();
    }
    return Date.prototype.toISOString.call(value);
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
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw invalidPayload();
        }
        result.push(canonicalize(value[index], ancestors, depth + 1));
      }
      return result;
    }

    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw invalidPayload();
      }
      assertSafeProperty(key, descriptor.value);
      result[key] = canonicalize(descriptor.value, ancestors, depth + 1);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function assertSafeProperty(key: string, value: unknown): void {
  const normalized = normalizeKey(key);

  if (SANITIZED_AUTHORIZATION_METADATA.has(normalized)) {
    assertSanitizedAuthorizationMetadata(normalized, value);
    return;
  }

  if (
    SENSITIVE_EXACT_KEYS.has(normalized) ||
    SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  ) {
    throw sensitiveData();
  }
}

function normalizeKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function assertSanitizedAuthorizationMetadata(key: string, value: unknown): void {
  if (key === 'supervisorauthorizationid') {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) {
      throw sensitiveData();
    }
    return;
  }

  const allowedStatuses = new Set([
    'APPROVED',
    'AUTHORIZED',
    'DENIED',
    'NOT_REQUIRED',
    'PENDING',
    'REJECTED',
    'UNAUTHORIZED',
  ]);
  if (typeof value !== 'string' || !allowedStatuses.has(value)) {
    throw sensitiveData();
  }
}

function sensitiveData(): OfflineStorageError {
  return new OfflineStorageError(
    'SENSITIVE_DATA',
    'O payload contém uma categoria de dado que não pode ser persistida.',
  );
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
