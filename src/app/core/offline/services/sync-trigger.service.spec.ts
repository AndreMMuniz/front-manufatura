import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYNC_SCHEDULER_CONFIG } from '../models/sync-error';
import { ConnectivityService } from './connectivity.service';
import { IntervalScheduler, SyncTriggerService } from './sync-trigger.service';

describe('SyncTriggerService', () => {
  it('combina startup, online, intervalo e API manual e descarta recursos', () => {
    const changes = new Subject<boolean>();
    const connectivity = {
      isBrowser: true,
      changes$: changes.asObservable(),
    } as Pick<ConnectivityService, 'isBrowser' | 'changes$'>;
    let intervalCallback = () => undefined;
    const cancel = vi.fn();
    const scheduler: IntervalScheduler = {
      start: vi.fn((callback) => {
        intervalCallback = callback;
        return cancel;
      }),
    };
    const service = new SyncTriggerService(
      connectivity as ConnectivityService,
      { ...DEFAULT_SYNC_SCHEDULER_CONFIG, intervalMs: 10_000 },
      scheduler,
    );
    const trigger = vi.fn();

    service.start(trigger);
    changes.next(false);
    changes.next(true);
    intervalCallback();
    service.requestSync();

    expect(trigger.mock.calls.map(([reason]) => reason)).toEqual([
      'startup',
      'online',
      'interval',
      'manual',
    ]);
    service.stop();
    changes.next(true);
    intervalCallback();
    expect(trigger).toHaveBeenCalledTimes(4);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('não inicia listener ou timer no SSR', () => {
    const scheduler: IntervalScheduler = { start: vi.fn(() => vi.fn()) };
    const service = new SyncTriggerService(
      { isBrowser: false, changes$: new Subject<boolean>() } as unknown as ConnectivityService,
      DEFAULT_SYNC_SCHEDULER_CONFIG,
      scheduler,
    );
    const trigger = vi.fn();

    service.start(trigger);
    service.requestSync();

    expect(trigger).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });
});
