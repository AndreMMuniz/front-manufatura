import { InjectionToken } from '@angular/core';

export type SyncClock = () => Date;

export const SYNC_CLOCK = new InjectionToken<SyncClock>('SYNC_CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});
