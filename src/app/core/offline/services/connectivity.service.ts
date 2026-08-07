import { Inject, Injectable, InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable } from 'rxjs';

export interface BrowserNetwork {
  readonly navigator: Pick<Navigator, 'onLine'>;
  readonly addEventListener: (type: 'online' | 'offline', listener: EventListener) => void;
  readonly removeEventListener: (type: 'online' | 'offline', listener: EventListener) => void;
}

export const BROWSER_NETWORK = new InjectionToken<BrowserNetwork | null>('BROWSER_NETWORK', {
  providedIn: 'root',
  factory: () => {
    const platformId = inject(PLATFORM_ID);
    if (!isPlatformBrowser(platformId) || typeof globalThis.window === 'undefined') {
      return null;
    }
    return globalThis.window;
  },
});

@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly isBrowser: boolean;
  readonly changes$: Observable<boolean>;

  constructor(@Inject(BROWSER_NETWORK) private readonly network: BrowserNetwork | null) {
    this.isBrowser = network !== null;
    this.changes$ = new Observable<boolean>((subscriber) => {
      if (!this.network) {
        subscriber.complete();
        return undefined;
      }
      const online: EventListener = () => subscriber.next(true);
      const offline: EventListener = () => subscriber.next(false);
      this.network.addEventListener('online', online);
      this.network.addEventListener('offline', offline);
      return () => {
        this.network?.removeEventListener('online', online);
        this.network?.removeEventListener('offline', offline);
      };
    });
  }

  get onlineHint(): boolean {
    return this.network?.navigator.onLine ?? false;
  }
}
