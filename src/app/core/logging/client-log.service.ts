import { isPlatformBrowser } from '@angular/common';
import { HttpBackend, HttpClient, HttpHeaders } from '@angular/common/http';
import { Inject, Injectable, InjectionToken, PLATFORM_ID } from '@angular/core';
import { EMPTY, catchError, timeout } from 'rxjs';

import {
  type ClientLogEvent,
  validateClientLogEvent,
} from '../../../logging/client-log-contracts';

export type ClientLogCapture = Omit<ClientLogEvent, 'timestamp'> & {
  readonly timestamp?: string;
};

export type ClientLogClock = () => number;

export const CLIENT_LOG_CLOCK = new InjectionToken<ClientLogClock>('CLIENT_LOG_CLOCK', {
  providedIn: 'root',
  factory: () => Date.now,
});

const GLOBAL_DEDUPE_WINDOW_MS = 1_000;
const MAX_GLOBAL_SIGNATURES = 100;
const SEND_TIMEOUT_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class ClientLogService {
  private readonly http: HttpClient;
  private readonly browser: boolean;
  private readonly angularErrorSignatures = new Map<string, number>();

  constructor(
    backend: HttpBackend,
    @Inject(PLATFORM_ID) platformId: object,
    @Inject(CLIENT_LOG_CLOCK) private readonly clock: ClientLogClock,
  ) {
    this.http = new HttpClient(backend);
    this.browser = isPlatformBrowser(platformId);
  }

  capture(input: ClientLogCapture): void {
    if (!this.browser) return;
    try {
      const now = this.clock();
      if (!Number.isFinite(now)) return;
      const validation = validateClientLogEvent({
        ...input,
        timestamp: input.timestamp ?? new Date(now).toISOString(),
      });
      if (!validation.ok) return;
      const event = validation.event;
      if (event.event === 'angular_error' && this.isDuplicateAngularError(event, now)) return;

      const headers = event.correlationId
        ? new HttpHeaders({ 'X-Correlation-Id': event.correlationId })
        : undefined;
      this.http.post('/api/client-logs', event, {
        headers,
        credentials: 'omit',
        observe: 'response',
        responseType: 'text',
      }).pipe(
        timeout(SEND_TIMEOUT_MS),
        catchError(() => EMPTY),
      ).subscribe({ error: () => undefined });
    } catch {
      // Diagnostics are strictly best-effort and cannot affect application behavior.
    }
  }

  private isDuplicateAngularError(event: ClientLogEvent, now: number): boolean {
    for (const [signature, capturedAt] of this.angularErrorSignatures) {
      if (now - capturedAt >= GLOBAL_DEDUPE_WINDOW_MS) {
        this.angularErrorSignatures.delete(signature);
      }
    }
    const signature = `${event.event}\u0000${event.message ?? ''}\u0000${event.stack ?? ''}`;
    const capturedAt = this.angularErrorSignatures.get(signature);
    if (capturedAt !== undefined && now - capturedAt < GLOBAL_DEDUPE_WINDOW_MS) return true;

    if (this.angularErrorSignatures.size >= MAX_GLOBAL_SIGNATURES) {
      const oldest = this.angularErrorSignatures.keys().next().value as string | undefined;
      if (oldest !== undefined) this.angularErrorSignatures.delete(oldest);
    }
    this.angularErrorSignatures.set(signature, now);
    return false;
  }
}
