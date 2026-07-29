import { provideRouter } from '@angular/router';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';

import {
  ApplicationConfig,
  PLATFORM_ID,
  afterNextRender,
  inject,
  importProvidersFrom,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';

import { PoHttpRequestModule, PoNotificationService } from '@po-ui/ng-components';
import { TopNotificationService } from './core/notifications/top-notification.service';
import { SyncCoordinatorService } from './core/offline/services/sync-coordinator.service';
import { provideServiceWorker } from '@angular/service-worker';
import { PwaUpdateService } from './core/offline/pwa/pwa-update.service';
import { StorageHealthService } from './core/offline/services/storage-health.service';

export type AfterRenderScheduler = (callback: () => void) => void;

export function initializeSyncRuntime(
  platformId: unknown,
  coordinator: Pick<SyncCoordinatorService, 'start'>,
  scheduleAfterRender: AfterRenderScheduler = afterNextRender,
  pwaUpdate?: Pick<PwaUpdateService, 'start'>,
  storageHealth?: Pick<StorageHealthService, 'assess'>,
): void {
  if (isPlatformBrowser(platformId as object)) {
    scheduleAfterRender(() => {
      pwaUpdate?.start();
      void storageHealth?.assess();
      coordinator.start();
    });
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    importProvidersFrom([BrowserAnimationsModule, PoHttpRequestModule]),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch(), withInterceptorsFromDi()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    { provide: PoNotificationService, useClass: TopNotificationService },
    provideAppInitializer(() => {
      const coordinator = inject(SyncCoordinatorService);
      const pwaUpdate = inject(PwaUpdateService);
      const storageHealth = inject(StorageHealthService);
      initializeSyncRuntime(
        inject(PLATFORM_ID),
        coordinator,
        afterNextRender,
        pwaUpdate,
        storageHealth,
      );
    }),
  ],
};
