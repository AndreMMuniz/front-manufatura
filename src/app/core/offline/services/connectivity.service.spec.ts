import { describe, expect, it, vi } from 'vitest';

import { BrowserNetwork, ConnectivityService } from './connectivity.service';

describe('ConnectivityService', () => {
  it('é no-op no SSR sem consultar window, navigator ou listeners', () => {
    const service = new ConnectivityService(null);
    const received: boolean[] = [];
    const subscription = service.changes$.subscribe((value) => received.push(value));

    expect(service.isBrowser).toBe(false);
    expect(service.onlineHint).toBe(false);
    expect(received).toEqual([]);
    subscription.unsubscribe();
  });

  it('expõe onLine somente como hint e encaminha online/offline com cleanup', () => {
    const listeners = new Map<string, EventListener>();
    const network: BrowserNetwork = {
      navigator: { onLine: true },
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type) => listeners.delete(type)),
    };
    const service = new ConnectivityService(network);
    const received: boolean[] = [];
    const subscription = service.changes$.subscribe((value) => received.push(value));

    expect(service.onlineHint).toBe(true);
    listeners.get('offline')?.(new Event('offline'));
    listeners.get('online')?.(new Event('online'));
    expect(received).toEqual([false, true]);

    subscription.unsubscribe();
    expect(network.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
