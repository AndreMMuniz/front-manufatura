export type OfflineStorageErrorCode =
  | 'ABORTED'
  | 'BLOCKED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CONFLICT'
  | 'CONSTRAINT'
  | 'PAYLOAD_INVALID'
  | 'QUOTA_EXCEEDED'
  | 'SCHEMA_INVALID'
  | 'SECURITY'
  | 'SENSITIVE_DATA'
  | 'UNKNOWN'
  | 'VERSION_INCOMPATIBLE';

export class OfflineStorageError extends Error {
  override readonly name = 'OfflineStorageError';

  constructor(
    readonly code: OfflineStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function toOfflineStorageError(error: unknown, fallbackMessage: string): OfflineStorageError {
  if (error instanceof OfflineStorageError) {
    return error;
  }

  const name = error instanceof DOMException ? error.name : '';
  const mapping: Partial<Record<string, OfflineStorageErrorCode>> = {
    AbortError: 'ABORTED',
    ConstraintError: 'CONSTRAINT',
    QuotaExceededError: 'QUOTA_EXCEEDED',
    SecurityError: 'SECURITY',
    VersionError: 'VERSION_INCOMPATIBLE',
  };

  return new OfflineStorageError(mapping[name] ?? 'UNKNOWN', fallbackMessage);
}
