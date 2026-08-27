import { inject, InjectionToken } from '@angular/core';

import { OperationalCommandType } from '../models/operational-command';
import { CommandResult, SyncCommandRequest } from '../models/sync-command';
import { SyncConfigurationError } from '../models/sync-error';

export type ConfirmationResult =
  | { readonly kind: 'MATCH'; readonly result: CommandResult }
  | { readonly kind: 'MISSING' }
  | { readonly kind: 'CONFLICT'; readonly code: string; readonly userMessage: string }
  | { readonly kind: 'INCONCLUSIVE'; readonly code: string; readonly userMessage: string };

export interface CommandConfirmationHandler {
  readonly commandType: OperationalCommandType;
  readonly confirm: (
    request: SyncCommandRequest,
    signal: AbortSignal,
  ) => Promise<ConfirmationResult>;
}

export const COMMAND_CONFIRMATION_HANDLERS =
  new InjectionToken<readonly CommandConfirmationHandler[]>('COMMAND_CONFIRMATION_HANDLERS');

export const COMMAND_CONFIRMATION_ROUTER =
  new InjectionToken<CommandConfirmationRouter>('COMMAND_CONFIRMATION_ROUTER', {
    providedIn: 'root',
    factory: () => new CommandConfirmationRouter(
      inject(COMMAND_CONFIRMATION_HANDLERS, { optional: true }) ?? [],
    ),
  });

export class CommandConfirmationRouter {
  private readonly handlers: ReadonlyMap<OperationalCommandType, CommandConfirmationHandler>;

  constructor(handlers: readonly CommandConfirmationHandler[]) {
    const indexed = new Map<OperationalCommandType, CommandConfirmationHandler>();
    for (const handler of handlers) {
      if (indexed.has(handler.commandType)) {
        throw new SyncConfigurationError(
          'DUPLICATE_CONFIRMATION_HANDLER',
          `Existe mais de um verificador configurado para ${handler.commandType}.`,
        );
      }
      indexed.set(handler.commandType, handler);
    }
    this.handlers = indexed;
  }

  confirm(
    request: SyncCommandRequest,
    signal: AbortSignal,
  ): Promise<ConfirmationResult | undefined> {
    const handler = this.handlers.get(request.commandType as OperationalCommandType);
    return handler ? handler.confirm(request, signal) : Promise.resolve(undefined);
  }

  supports(request: Pick<SyncCommandRequest, 'commandType'>): boolean {
    return this.handlers.has(request.commandType as OperationalCommandType);
  }
}
