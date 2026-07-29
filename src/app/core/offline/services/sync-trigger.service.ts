import { Inject, Injectable, InjectionToken, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import {
  DEFAULT_SYNC_SCHEDULER_CONFIG,
  SyncSchedulerConfig,
} from '../models/sync-error';
import { ConnectivityService } from './connectivity.service';

export type SyncTriggerReason = 'startup' | 'online' | 'interval' | 'manual';

export interface IntervalScheduler {
  readonly start: (callback: () => void, intervalMs: number) => () => void;
}

export const SYNC_SCHEDULER_CONFIGURATION = new InjectionToken<SyncSchedulerConfig>(
  'SYNC_SCHEDULER_CONFIGURATION',
  {
    providedIn: 'root',
    factory: () => DEFAULT_SYNC_SCHEDULER_CONFIG,
  },
);

export const SYNC_INTERVAL_SCHEDULER = new InjectionToken<IntervalScheduler>(
  'SYNC_INTERVAL_SCHEDULER',
  {
    providedIn: 'root',
    factory: () => ({
      start: (callback, intervalMs) => {
        const handle = globalThis.setInterval(callback, intervalMs);
        return () => globalThis.clearInterval(handle);
      },
    }),
  },
);

@Injectable({ providedIn: 'root' })
export class SyncTriggerService implements OnDestroy {
  private callback?: (reason: SyncTriggerReason) => void;
  private connectivitySubscription?: Subscription;
  private cancelInterval?: () => void;

  constructor(
    private readonly connectivity: ConnectivityService,
    @Inject(SYNC_SCHEDULER_CONFIGURATION) private readonly config: SyncSchedulerConfig,
    @Inject(SYNC_INTERVAL_SCHEDULER) private readonly scheduler: IntervalScheduler,
  ) {}

  start(callback: (reason: SyncTriggerReason) => void): void {
    if (!this.connectivity.isBrowser || this.callback) {
      return;
    }
    this.callback = callback;
    this.connectivitySubscription = this.connectivity.changes$.subscribe((online) => {
      if (online) {
        this.callback?.('online');
      }
    });
    this.cancelInterval = this.scheduler.start(
      () => this.callback?.('interval'),
      this.config.intervalMs,
    );
    this.callback('startup');
  }

  requestSync(): void {
    this.callback?.('manual');
  }

  stop(): void {
    this.connectivitySubscription?.unsubscribe();
    this.connectivitySubscription = undefined;
    this.cancelInterval?.();
    this.cancelInterval = undefined;
    this.callback = undefined;
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
