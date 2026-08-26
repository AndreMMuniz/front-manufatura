// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { transports } from 'winston';
import type DailyRotateFile from 'winston-daily-rotate-file';

import {
  buildRotatingFileOptions,
  createServerLogger,
  readServerLogConfig,
} from './server-logger';

describe('server logger configuration', () => {
  it('aplica defaults operacionais', () => {
    expect(readServerLogConfig({}, '/srv/front')).toEqual({
      level: 'info',
      directory: '/srv/front/logs',
      retentionDays: 14,
      maxSize: '20m',
    });
  });

  it('aceita configuração válida e resolve diretório relativo', () => {
    expect(readServerLogConfig({
      APP_LOG_LEVEL: 'debug',
      APP_LOG_DIR: 'diagnostico',
      APP_LOG_RETENTION_DAYS: '7',
      APP_LOG_MAX_SIZE: '512k',
    }, '/srv/front')).toEqual({
      level: 'debug',
      directory: '/srv/front/diagnostico',
      retentionDays: 7,
      maxSize: '512k',
    });
  });

  it('preserva diretório absoluto', () => {
    expect(readServerLogConfig({ APP_LOG_DIR: '/var/tmp/front-logs' }, '/srv/front').directory)
      .toBe('/var/tmp/front-logs');
  });

  it.each([
    [{ APP_LOG_LEVEL: 'trace' }, 'APP_LOG_LEVEL'],
    [{ APP_LOG_RETENTION_DAYS: '0' }, 'APP_LOG_RETENTION_DAYS'],
    [{ APP_LOG_RETENTION_DAYS: '14.5' }, 'APP_LOG_RETENTION_DAYS'],
    [{ APP_LOG_MAX_SIZE: '20mb' }, 'APP_LOG_MAX_SIZE'],
    [{ APP_LOG_MAX_SIZE: '11g' }, 'APP_LOG_MAX_SIZE'],
    [{ APP_LOG_MAX_SIZE: '999999999999999999999g' }, 'APP_LOG_MAX_SIZE'],
  ])('rejeita configuração inválida %o', (env, expected) => {
    expect(() => readServerLogConfig(env, '/srv/front')).toThrow(expected);
  });

  it('traduz retenção, tamanho e audit file para a rotação diária', () => {
    expect(buildRotatingFileOptions({
      level: 'info', directory: '/srv/front/logs', retentionDays: 14, maxSize: '20m',
    })).toMatchObject({
      dirname: '/srv/front/logs',
      filename: 'application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m',
      auditFile: '/srv/front/logs/.application-log-audit.json',
    });
  });

  it('mantém console-only quando o diretório não pode ser criado', async () => {
    const fallback = vi.fn();
    const logger = createServerLogger({}, '/srv/front', {
      ensureDirectory: () => { throw new Error('sem-permissao'); },
      reportFallback: fallback,
    });

    expect(() => logger.info('api_request_completed', { status: 200 })).not.toThrow();
    expect(fallback).toHaveBeenCalledOnce();
    await logger.close();
  });

  it('remove transporte que falha de forma assíncrona e avisa uma única vez', async () => {
    const fallback = vi.fn();
    const transport = new transports.Stream({ stream: new PassThrough() });
    const writes: unknown[] = [];
    (transport as unknown as { log: (info: unknown, callback: () => void) => void }).log =
      (info, callback) => { writes.push(info); callback(); };
    const close = vi.fn();
    Object.assign(transport, { close });
    const logger = createServerLogger({}, '/srv/front', {
      ensureDirectory: vi.fn(),
      createRotatingTransport: () => transport as unknown as DailyRotateFile,
      reportFallback: fallback,
    });

    transport.emit('error', new Error('disk secret'));
    transport.emit('error', new Error('disk secret again'));
    expect(() => logger.info('api_request_completed', { status: 200 })).not.toThrow();
    await Promise.resolve();
    expect(fallback).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    await logger.close();
  });

  it('grava cada evento com timestamp ISO, nível destacado e metadados estruturados', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'plano-log-'));
    try {
      const logger = createServerLogger({ APP_LOG_DIR: directory }, '/srv/front');
      logger.info('safe_event', { status: 200, senha: 'sentinela-secreta' });
      logger.error('failed_event', { status: 500 });
      await logger.close();
      const file = readdirSync(directory).find(name => /^application-.*\.log$/.test(name));
      expect(file).toBeTruthy();
      await vi.waitFor(() => expect(readFileSync(join(directory, file!), 'utf8').trim()).not.toBe(''));
      const lines = readFileSync(join(directory, file!), 'utf8').trim().split(/\r?\n/);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] safe_event \| \{"status":200,"senha":"\[REDACTED\]"\}$/,
      );
      expect(lines[1]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[ERROR\] failed_event \| \{"status":500\}$/,
      );
      expect(lines.join('\n')).not.toContain('sentinela-secreta');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
