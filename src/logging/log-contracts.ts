export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogMetadata = Readonly<Record<string, unknown>>;

export interface ApplicationLogger {
  debug(event: string, metadata?: LogMetadata): void;
  info(event: string, metadata?: LogMetadata): void;
  warn(event: string, metadata?: LogMetadata): void;
  error(event: string, metadata?: LogMetadata): void;
  close(): Promise<void>;
}

export const noopLogger: ApplicationLogger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  close: () => Promise.resolve(),
});
