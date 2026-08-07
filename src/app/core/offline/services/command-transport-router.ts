import { InjectionToken } from '@angular/core';

import { CommandResult, SyncCommandRequest } from '../models/sync-command';
import { SyncConfigurationError } from '../models/sync-error';
import { OperationalCommandType } from '../models/operational-command';
import type { SyncTransport } from './sync-transport';

export interface SyncCommandHandler {
  readonly commandType: OperationalCommandType;
  readonly send: (
    request: SyncCommandRequest,
    signal: AbortSignal,
  ) => Promise<CommandResult>;
}

export const SYNC_COMMAND_HANDLERS =
  new InjectionToken<readonly SyncCommandHandler[]>('SYNC_COMMAND_HANDLERS');

export class CommandTransportRouter implements SyncTransport {
  private readonly handlers: ReadonlyMap<OperationalCommandType, SyncCommandHandler>;

  constructor(handlers: readonly SyncCommandHandler[]) {
    const indexed = new Map<OperationalCommandType, SyncCommandHandler>();
    for (const handler of handlers) {
      if (indexed.has(handler.commandType)) {
        throw new SyncConfigurationError(
          'DUPLICATE_COMMAND_HANDLER',
          `Existe mais de um adapter configurado para ${handler.commandType}.`,
        );
      }
      indexed.set(handler.commandType, handler);
    }
    this.handlers = indexed;
  }

  send(request: SyncCommandRequest, signal: AbortSignal): Promise<CommandResult> {
    const handler = this.handlers.get(request.commandType as OperationalCommandType);
    if (!handler) {
      return Promise.reject(
        new SyncConfigurationError(
          'UNSUPPORTED_COMMAND',
          `Não existe adapter Datasul configurado para ${request.commandType}.`,
        ),
      );
    }
    return handler.send(request, signal);
  }
}
