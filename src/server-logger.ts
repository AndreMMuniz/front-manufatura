import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { createLogger, format, transports, type Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import type { AppLogLevel, ApplicationLogger, LogMetadata } from './logging/log-contracts';
import { sanitizeLogMetadata, sanitizeLogText } from './logging/log-sanitizer';

export type ServerLogEnvironment = Readonly<Record<string, string | undefined>>;

export interface ServerLogConfig {
  readonly level: AppLogLevel;
  readonly directory: string;
  readonly retentionDays: number;
  readonly maxSize: string;
}

export interface ServerLoggerDependencies {
  readonly ensureDirectory?: (directory: string) => void;
  readonly createRotatingTransport?: (
    options: NonNullable<ConstructorParameters<typeof DailyRotateFile>[0]>,
  ) => DailyRotateFile;
  readonly reportFallback?: (message: string) => void;
}

const LEVELS: readonly AppLogLevel[] = ['debug', 'info', 'warn', 'error'];

export function readServerLogConfig(
  env: ServerLogEnvironment,
  workingDirectory = process.cwd(),
): ServerLogConfig {
  const rawLevel = env['APP_LOG_LEVEL']?.trim().toLowerCase() || 'info';
  if (!LEVELS.includes(rawLevel as AppLogLevel)) {
    throw new Error('APP_LOG_LEVEL inválido; use debug, info, warn ou error.');
  }
  const rawDirectory = env['APP_LOG_DIR']?.trim() || 'logs';
  if (rawDirectory.includes('\0')) {
    throw new Error('APP_LOG_DIR inválido.');
  }
  const directory = isAbsolute(rawDirectory)
    ? rawDirectory
    : resolve(workingDirectory, rawDirectory);
  const rawRetention = env['APP_LOG_RETENTION_DAYS']?.trim() || '14';
  if (!/^\d+$/.test(rawRetention)) {
    throw new Error('APP_LOG_RETENTION_DAYS inválido; informe um inteiro positivo.');
  }
  const retentionDays = Number(rawRetention);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('APP_LOG_RETENTION_DAYS inválido; informe um inteiro entre 1 e 3650.');
  }
  const maxSize = env['APP_LOG_MAX_SIZE']?.trim().toLowerCase() || '20m';
  if (!/^[1-9]\d*(?:k|m|g)$/.test(maxSize)) {
    throw new Error('APP_LOG_MAX_SIZE inválido; use número seguido de k, m ou g.');
  }
  return {
    level: rawLevel as AppLogLevel,
    directory,
    retentionDays,
    maxSize,
  };
}

export function createServerLogger(
  env: ServerLogEnvironment = process.env,
  workingDirectory = process.cwd(),
  dependencies: ServerLoggerDependencies = {},
): ApplicationLogger & { readonly config: ServerLogConfig } {
  const config = readServerLogConfig(env, workingDirectory);
  let fileFailureReported = false;
  const fallback = dependencies.reportFallback ?? (message => console.error(message));
  const reportFileFailure = () => {
    if (fileFailureReported) return;
    fileFailureReported = true;
    fallback('[WARN] server_log_file_unavailable; mantendo saída no terminal.');
  };
  const logger = createLogger({
    level: config.level,
    transports: [
      new transports.Console({
        level: config.level,
        format: format.combine(
          format.timestamp(),
          format.printf(info => {
            const { timestamp, level, message, ...metadata } = info;
            const suffix = Object.keys(metadata).length > 0
              ? ` ${JSON.stringify(sanitizeLogMetadata(metadata))}`
              : '';
            return `${String(timestamp)} ${String(level).toUpperCase()} ${sanitizeLogText(String(message))}${suffix}`;
          }),
        ),
      }),
    ],
  });
  logger.on('error', reportFileFailure);

  try {
    (dependencies.ensureDirectory ?? (directory => mkdirSync(directory, { recursive: true })))(
      config.directory,
    );
    const rotatingFile = (dependencies.createRotatingTransport ??
      (options => new DailyRotateFile(options)))({
      ...buildRotatingFileOptions(config),
      format: format.combine(format.timestamp(), format.json()),
    });
    rotatingFile.on('error', () => {
      reportFileFailure();
      logger.remove(rotatingFile);
      try { rotatingFile.close(); } catch { /* console transport remains active */ }
    });
    logger.add(rotatingFile);
  } catch {
    reportFileFailure();
  }
  return wrapLogger(logger, config);
}

export function buildRotatingFileOptions(
  config: ServerLogConfig,
): NonNullable<ConstructorParameters<typeof DailyRotateFile>[0]> {
  return {
    dirname: config.directory,
    filename: 'application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: `${config.retentionDays}d`,
    maxSize: config.maxSize,
    auditFile: resolve(config.directory, '.application-log-audit.json'),
    level: config.level,
  };
}

function wrapLogger(
  logger: Logger,
  config: ServerLogConfig,
): ApplicationLogger & { readonly config: ServerLogConfig } {
  const write = (level: AppLogLevel, event: string, metadata: LogMetadata = {}) => {
    try {
      logger.log(level, sanitizeLogText(event, 200), sanitizeLogMetadata(metadata));
    } catch {
      console.error('[WARN] server_logger_write_failed.');
    }
  };
  let closePromise: Promise<void> | undefined;
  return {
    config,
    debug: (event, metadata) => write('debug', event, metadata),
    info: (event, metadata) => write('info', event, metadata),
    warn: (event, metadata) => write('warn', event, metadata),
    error: (event, metadata) => write('error', event, metadata),
    close: () => closePromise ??= closeLogger(logger),
  };
}

function closeLogger(logger: Logger): Promise<void> {
  const transportFlushes = logger.transports.map(transport => new Promise<void>(resolveFlush => {
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      transport.off('finish', finish);
      transport.off('close', finish);
      transport.off('error', finish);
      resolveFlush();
    };
    transport.once('finish', finish);
    transport.once('close', finish);
    transport.once('error', finish);
  }));
  logger.end();
  return new Promise(resolveClose => {
    const timeout = globalThis.setTimeout(resolveClose, 1_000);
    void Promise.all(transportFlushes).then(() => {
      globalThis.clearTimeout(timeout);
      resolveClose();
    });
  });
}
