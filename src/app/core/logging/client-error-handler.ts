import { ErrorHandler, Injectable } from '@angular/core';

import { sanitizeLogText } from '../../../logging/log-sanitizer';
import { ClientLogService } from './client-log.service';

const SAFE_CODE = /^[A-Z0-9_.-]{1,64}$/;

@Injectable()
export class ClientErrorHandler extends ErrorHandler {
  constructor(private readonly clientLogs: ClientLogService) {
    super();
  }

  override handleError(error: unknown): void {
    try {
      const rawMessage = dataProperty(error, 'message')
        ?? (typeof error === 'string' ? error : 'Erro não identificado.');
      const rawStack = dataProperty(error, 'stack');
      const rawCode = dataProperty(error, 'code');
      const code = typeof rawCode === 'string' && SAFE_CODE.test(rawCode) ? rawCode : undefined;
      this.clientLogs.capture({
        level: 'error',
        category: 'browser',
        event: 'angular_error',
        message: sanitizeLogText(String(rawMessage), 1_000),
        ...(rawStack !== undefined
          ? { stack: sanitizeLogText(String(rawStack), 4_000) }
          : {}),
        ...(code ? { context: { code } } : {}),
      });
    } catch {
      // The Angular error pipeline must continue even if diagnostics fail.
    }
    super.handleError(error);
  }
}

function dataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && 'value' in descriptor) return descriptor.value;
  if (value instanceof Error && (key === 'message' || key === 'stack')) {
    try {
      return key === 'message' ? value.message : value.stack;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
