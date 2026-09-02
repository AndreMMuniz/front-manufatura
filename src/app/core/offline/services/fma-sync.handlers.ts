import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

import { AuthSessionService } from '../../auth/auth-session.service';
import { JsonValue } from '../models/local-record';
import { OperationalCommandType } from '../models/operational-command';
import { CommandResult, SyncCommandRequest } from '../models/sync-command';
import { SyncCommandHandler } from './command-transport-router';

@Injectable()
abstract class FmaSyncHandler implements SyncCommandHandler {
  abstract readonly commandType: OperationalCommandType;
  protected abstract endpoint(request: SyncCommandRequest): string;

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthSessionService,
  ) {}

  send(request: SyncCommandRequest, signal: AbortSignal): Promise<CommandResult> {
    const token = this.auth.token;
    if (!token) throw { status: 401, code: 'SESSION_REQUIRED', category: 'AUTH' };
    return abortable(this.http.post<CommandResult>(
      this.endpoint(request),
      request.payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': request.idempotencyKey,
        },
      },
    ), signal);
  }
}

@Injectable()
export class StartOperationSyncHandler extends FmaSyncHandler {
  readonly commandType = 'START_OPERATION' as const;
  protected endpoint(): string { return '/api/operations/start'; }
}

@Injectable()
export class ReportOperationSyncHandler extends FmaSyncHandler {
  readonly commandType = 'REPORT_OPERATION' as const;
  protected endpoint(): string { return '/api/operations/report'; }
}

@Injectable()
export class EndOperationSyncHandler extends FmaSyncHandler {
  readonly commandType = 'END_OPERATION' as const;
  protected endpoint(): string { return '/api/operations/end'; }
}

@Injectable()
export class StartBatchSyncHandler extends FmaSyncHandler {
  readonly commandType = 'START_BATCH' as const;
  protected endpoint(): string { return '/api/batches/start'; }
}

@Injectable()
export class ReportBatchSyncHandler extends FmaSyncHandler {
  readonly commandType = 'REPORT_BATCH' as const;
  protected endpoint(): string { return '/api/batches/report'; }
}

@Injectable()
export class EndBatchSyncHandler extends FmaSyncHandler {
  readonly commandType = 'END_BATCH' as const;
  protected endpoint(): string { return '/api/batches/end'; }
}

@Injectable()
export class CreateStopSyncHandler extends FmaSyncHandler {
  readonly commandType = 'CREATE_STOP' as const;
  protected endpoint(): string { return '/api/production-stops'; }
}

@Injectable()
export class FinishStopSyncHandler extends FmaSyncHandler {
  readonly commandType = 'FINISH_STOP' as const;
  protected endpoint(request: SyncCommandRequest): string {
    const payload = objectOf(request.payload);
    if (payload['stopLocalId'] === undefined) {
      return '/api/production-stops/finish';
    }
    const stopLocalId = requiredText(payload['stopLocalId']);
    return `/api/production-stops/${encodeURIComponent(stopLocalId)}/finish`;
  }
}

@Injectable()
export class DeleteStopSyncHandler extends FmaSyncHandler {
  readonly commandType = 'DELETE_STOP' as const;
  protected endpoint(request: SyncCommandRequest): string {
    const payload = objectOf(request.payload);
    const stopLocalId = requiredText(payload['stopLocalId']);
    return `/api/production-stops/${encodeURIComponent(stopLocalId)}/eliminate`;
  }
}

function objectOf(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid-fma-command-payload');
  }
  return value as Readonly<Record<string, JsonValue>>;
}

function requiredText(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('invalid-fma-command-payload');
  return value.trim();
}

function abortable<T>(source: Observable<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let subscription = new Subscription();
    const abort = () => {
      subscription.unsubscribe();
      reject(signal.reason ?? new Error('request-aborted'));
    };
    subscription = source.subscribe({
      next: value => {
        signal.removeEventListener('abort', abort);
        subscription.unsubscribe();
        resolve(value);
      },
      error: error => {
        signal.removeEventListener('abort', abort);
        reject(publicCommandError(error));
      },
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function publicCommandError(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error;
  const response = error as Readonly<Record<string, unknown>>;
  const body = response['error'];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error;
  const publicBody = body as Readonly<Record<string, unknown>>;
  if (
    typeof response['status'] !== 'number'
    || typeof publicBody['code'] !== 'string'
    || typeof publicBody['category'] !== 'string'
    || typeof publicBody['userMessage'] !== 'string'
  ) return error;
  return {
    status: response['status'],
    code: publicBody['code'],
    category: publicBody['category'],
    userMessage: publicBody['userMessage'],
  };
}
