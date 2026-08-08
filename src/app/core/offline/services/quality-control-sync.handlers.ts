import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

import { AuthSessionService } from '../../auth/auth-session.service';
import { JsonValue } from '../models/local-record';
import { CommandResult, SyncCommandRequest } from '../models/sync-command';
import { SyncCommandHandler } from './command-transport-router';

@Injectable()
export class SaveQualityResultSyncHandler implements SyncCommandHandler {
  readonly commandType = 'SAVE_QUALITY_RESULT' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthSessionService,
  ) {}

  async send(request: SyncCommandRequest, signal: AbortSignal): Promise<CommandResult> {
    const body = qualityResultBody(request.payload);
    const response = await abortable(this.http.put<unknown>(
      '/api/quality-control/results',
      body,
      { headers: headers(this.auth, request.idempotencyKey) },
    ), signal);
    const result = resultReceipt(response, body);
    const now = new Date().toISOString();
    return {
      serverRecordId: `quality-result:${result.nrFicha}:${result.codExame}:${result.codComponente}`,
      idempotencyKey: request.idempotencyKey,
      receivedAt: now,
      processedAt: now,
      duplicate: false,
      businessResult: {
        dentroFaixa: result.dentroFaixa,
        componentesSalvos: result.componentesSalvos,
        componentesTotal: result.componentesTotal,
      },
    };
  }
}

@Injectable()
export class FinalizeQualityRouteSyncHandler implements SyncCommandHandler {
  readonly commandType = 'FINALIZE_QUALITY_ROUTE' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthSessionService,
  ) {}

  async send(request: SyncCommandRequest, signal: AbortSignal): Promise<CommandResult> {
    const payload = objectOf(request.payload);
    const nrFicha = positiveInteger(payload['nrFicha']);
    const response = await abortable(this.http.put<unknown>(
      '/api/quality-control/routes/finalize',
      { nrFicha },
      { headers: headers(this.auth, request.idempotencyKey) },
    ), signal);
    const result = finalizeReceipt(response, nrFicha);
    if (!result.finalizado) {
      throw {
        code: 'QUALITY_ROUTE_NOT_FINALIZED',
        category: 'VALIDATION',
        userMessage: result.mensagem || 'O Datasul não finalizou o roteiro.',
      };
    }
    const now = new Date().toISOString();
    return {
      serverRecordId: `quality-route:${result.nrFicha}`,
      idempotencyKey: request.idempotencyKey,
      receivedAt: now,
      processedAt: now,
      duplicate: false,
      businessResult: {
        finalizado: result.finalizado,
        inspecionado: result.inspecionado,
        componentesPendentes: result.componentesPendentes,
        mensagem: result.mensagem,
      },
    };
  }
}

function headers(auth: AuthSessionService, idempotencyKey: string): HttpHeaders {
  const token = auth.token;
  if (!token) {
    throw { status: 401, code: 'SESSION_REQUIRED', category: 'AUTH' };
  }
  return new HttpHeaders({
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': idempotencyKey,
  });
}

function qualityResultBody(payloadValue: JsonValue): Record<string, number> {
  const payload = objectOf(payloadValue);
  const common = {
    nrFicha: positiveInteger(payload['nrFicha']),
    codExame: positiveInteger(payload['codExame']),
    codComponente: positiveInteger(payload['codComponente']),
  };
  const hasResult = payload['resultado'] !== undefined;
  const hasTableNumber = payload['nrTabela'] !== undefined;
  const hasOptionSequence = payload['seqOpcao'] !== undefined;
  const hasCompleteOption = hasTableNumber && hasOptionSequence;
  if (hasResult === hasCompleteOption || hasTableNumber !== hasOptionSequence) throw invalidReceipt();
  if (hasResult) {
    return { ...common, resultado: finiteNumber(payload['resultado']) };
  }
  return {
    ...common,
    nrTabela: positiveInteger(payload['nrTabela']),
    seqOpcao: positiveInteger(payload['seqOpcao']),
  };
}

function resultReceipt(value: unknown, expected: Record<string, number>): {
  nrFicha: number;
  codExame: number;
  codComponente: number;
  dentroFaixa: boolean;
  componentesSalvos: number;
  componentesTotal: number;
} {
  const envelope = singleItemEnvelope(value);
  const item = objectOf(envelope);
  const result = {
    nrFicha: positiveInteger(item['nrFicha']),
    codExame: positiveInteger(item['codExame']),
    codComponente: positiveInteger(item['codComponente']),
    dentroFaixa: booleanOf(item['dentroFaixa']),
    componentesSalvos: nonNegativeInteger(item['componentesSalvos']),
    componentesTotal: positiveInteger(item['componentesTotal']),
  };
  if (
    result.nrFicha !== expected['nrFicha']
    || result.codExame !== expected['codExame']
    || result.codComponente !== expected['codComponente']
    || result.componentesSalvos > result.componentesTotal
  ) throw invalidReceipt();
  return result;
}

function finalizeReceipt(value: unknown, expectedFicha: number): {
  nrFicha: number;
  finalizado: boolean;
  inspecionado: boolean;
  componentesTotal: number;
  componentesSalvos: number;
  componentesPendentes: number;
  mensagem: string;
} {
  const item = objectOf(singleItemEnvelope(value));
  const dataset = objectOf(item['ds-finaliza']);
  const route = objectOf(arrayOf(dataset['roteiro'])[0]);
  const result = {
    nrFicha: positiveInteger(route['nrFicha']),
    finalizado: booleanOf(route['finalizado']),
    inspecionado: booleanOf(route['inspecionado']),
    componentesTotal: positiveInteger(route['componentesTotal']),
    componentesSalvos: nonNegativeInteger(route['componentesSalvos']),
    componentesPendentes: nonNegativeInteger(route['componentesPendentes']),
    mensagem: typeof route['mensagem'] === 'string' ? route['mensagem'] : '',
  };
  if (
    result.nrFicha !== expectedFicha
    || result.componentesSalvos > result.componentesTotal
    || result.componentesPendentes > result.componentesTotal
    || result.componentesSalvos + result.componentesPendentes !== result.componentesTotal
  ) throw invalidReceipt();
  return result;
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidReceipt();
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidReceipt();
  return value;
}

function singleItemEnvelope(value: unknown): unknown {
  const envelope = objectOf(value);
  if (envelope['total'] !== 1 || envelope['hasNext'] !== false) throw invalidReceipt();
  const items = arrayOf(envelope['items']);
  if (items.length !== 1) throw invalidReceipt();
  return items[0];
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalidReceipt();
  return value as number;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidReceipt();
  return value as number;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidReceipt();
  return value;
}

function booleanOf(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidReceipt();
  return value;
}

function invalidReceipt(): Error {
  return new Error('invalid-quality-control-receipt');
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
        reject(error);
      },
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
