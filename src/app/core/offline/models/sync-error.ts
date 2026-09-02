export type ApiCommandErrorCategory = 'TRANSIENT' | 'AUTH' | 'VALIDATION' | 'CONFLICT';
export type SyncErrorCategory = ApiCommandErrorCategory | 'CONFIGURATION';

export interface ApiCommandError {
  readonly code: string;
  readonly category: ApiCommandErrorCategory;
  readonly userMessage: string;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;
}

export interface NormalizedSyncError {
  readonly code: string;
  readonly category: SyncErrorCategory;
  readonly userMessage: string;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;
}

export interface SyncSchedulerConfig {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly requestTimeoutMs: number;
  readonly leaseDurationMs: number;
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly concurrency: number;
}

export const DEFAULT_SYNC_SCHEDULER_CONFIG: SyncSchedulerConfig = Object.freeze({
  baseDelayMs: 1_000,
  maxDelayMs: 300_000,
  requestTimeoutMs: 60_000,
  leaseDurationMs: 90_000,
  intervalMs: 30_000,
  batchSize: 20,
  concurrency: 3,
});

const MAX_SAFE_RETRY_AFTER_SECONDS = 8_000_000_000_000;

export class SyncTimeoutError extends Error {
  constructor() {
    super('A requisição de sincronização excedeu o tempo configurado.');
    this.name = 'SyncTimeoutError';
  }
}

export class SyncConfigurationError extends Error {
  readonly category = 'CONFIGURATION' as const;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SyncConfigurationError';
  }
}

export function calculateRetryDelay(
  attemptCount: number,
  randomValue: number,
  config: Pick<SyncSchedulerConfig, 'baseDelayMs' | 'maxDelayMs'>,
  retryAfterSeconds?: number,
): number {
  const attempt = Math.max(1, Math.trunc(attemptCount));
  const random = Math.min(1, Math.max(0, Number.isFinite(randomValue) ? randomValue : 0));
  const exponential = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** Math.min(attempt - 1, 52),
  );
  const jitter = Math.round(exponential * random);
  const retryAfter =
    retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0
      ? Math.round(retryAfterSeconds * 1_000)
      : 0;
  return Math.max(1, jitter, retryAfter);
}

export function assertValidSyncSchedulerConfig(config: SyncSchedulerConfig): void {
  const positiveIntegers = [
    config.baseDelayMs,
    config.maxDelayMs,
    config.requestTimeoutMs,
    config.leaseDurationMs,
    config.intervalMs,
    config.batchSize,
    config.concurrency,
  ];
  if (
    positiveIntegers.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    config.baseDelayMs > config.maxDelayMs ||
    config.leaseDurationMs <= config.requestTimeoutMs
  ) {
    throw new SyncConfigurationError(
      'INVALID_SCHEDULER_CONFIGURATION',
      'A configuração do scheduler de sincronização é inválida.',
    );
  }
}

export function normalizeCommandError(error: unknown): NormalizedSyncError {
  if (error instanceof SyncConfigurationError) {
    return safeError(error.code, 'CONFIGURATION');
  }
  if (error instanceof SyncTimeoutError) {
    return safeError('TIMEOUT', 'TRANSIENT');
  }
  if (error instanceof TypeError) {
    return safeError('NETWORK', 'TRANSIENT');
  }

  const record = asRecord(error);
  const explicitCategory = apiCategory(record?.['category']);
  if (!explicitCategory && record?.['status'] === 0) {
    return safeError('NETWORK', 'TRANSIENT');
  }
  const status = httpStatus(record?.['status']);
  const category = explicitCategory ?? categoryForStatus(status);
  const code = safeCode(record?.['code'], status, category);
  const userMessage = safeUserMessage(record?.['userMessage'], category);
  const correlationId = safeCorrelationId(record?.['correlationId']);
  const retryAfterSeconds = safeRetryAfter(record?.['retryAfterSeconds']);

  return {
    code,
    category,
    userMessage,
    ...(correlationId ? { correlationId } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

function categoryForStatus(status: number | undefined): SyncErrorCategory {
  if (status === 401) {
    return 'AUTH';
  }
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return 'TRANSIENT';
  }
  if (status === 409) {
    return 'CONFLICT';
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return 'VALIDATION';
  }
  return 'CONFIGURATION';
}

function safeError(code: string, category: SyncErrorCategory): NormalizedSyncError {
  return {
    code,
    category,
    userMessage: defaultUserMessage(category),
  };
}

function safeCode(
  value: unknown,
  status: number | undefined,
  category: SyncErrorCategory,
): string {
  if (typeof value === 'string' && /^[A-Z0-9_.-]{1,64}$/.test(value)) {
    return value;
  }
  if (value !== undefined) {
    return 'INVALID_CODE';
  }
  return status === undefined ? `SYNC_${category}` : `HTTP_${status}`;
}

function safeUserMessage(value: unknown, category: SyncErrorCategory): string {
  if (typeof value !== 'string') {
    return defaultUserMessage(category);
  }
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240);
  if (
    !normalized ||
    /\b(password|passwd|senha|token|cookie|authorization|credential|credencial|jwt|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|supervisor[-_ ]?(?:pin|password|senha))\b/i.test(normalized)
  ) {
    return defaultUserMessage(category);
  }
  return normalized;
}

function defaultUserMessage(category: SyncErrorCategory): string {
  switch (category) {
    case 'TRANSIENT':
      return 'Serviço temporariamente indisponível; uma nova tentativa será realizada.';
    case 'AUTH':
      return 'A sessão precisa ser renovada para continuar a sincronização.';
    case 'VALIDATION':
      return 'O comando foi rejeitado e precisa de correção.';
    case 'CONFLICT':
      return 'O comando conflita com o estado remoto e precisa de intervenção.';
    case 'CONFIGURATION':
      return 'Não existe configuração válida para enviar este comando.';
  }
}

function safeCorrelationId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : undefined;
}

function safeRetryAfter(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SAFE_RETRY_AFTER_SECONDS
    ? value
    : undefined;
}

function apiCategory(value: unknown): ApiCommandErrorCategory | undefined {
  return value === 'TRANSIENT' ||
    value === 'AUTH' ||
    value === 'VALIDATION' ||
    value === 'CONFLICT'
    ? value
    : undefined;
}

function httpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
