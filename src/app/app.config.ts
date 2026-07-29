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
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';

import { PoHttpRequestModule, PoNotificationService } from '@po-ui/ng-components';
import { TopNotificationService } from './core/notifications/top-notification.service';
import { SyncCoordinatorService } from './core/offline/services/sync-coordinator.service';

export type AfterRenderScheduler = (callback: () => void) => void;

export function initializeSyncRuntime(
  platformId: object,
  coordinator: Pick<SyncCoordinatorService, 'start'>,
  scheduleAfterRender: AfterRenderScheduler = afterNextRender,
): void {
  if (isPlatformBrowser(platformId)) {
    scheduleAfterRender(() => coordinator.start());
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    importProvidersFrom([BrowserAnimationsModule, PoHttpRequestModule]),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch(), withInterceptorsFromDi()),
    { provide: PoNotificationService, useClass: TopNotificationService },
    provideAppInitializer(() => {
      const coordinator = inject(SyncCoordinatorService);
      initializeSyncRuntime(inject(PLATFORM_ID), coordinator);
    }),
  ],
};
