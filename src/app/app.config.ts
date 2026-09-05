import { provideRouter } from '@angular/router';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';

import {
  ApplicationConfig,
  ErrorHandler,
  PLATFORM_ID,
  afterNextRender,
  inject,
  importProvidersFrom,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';

import { PoHttpRequestModule, PoNotificationService } from '@po-ui/ng-components';
import { TopNotificationService } from './core/notifications/top-notification.service';
import { SyncCoordinatorService } from './core/offline/services/sync-coordinator.service';
import { provideServiceWorker } from '@angular/service-worker';
import { PwaUpdateService } from './core/offline/pwa/pwa-update.service';
import { StorageHealthService } from './core/offline/services/storage-health.service';
import { SyncRetentionService } from './core/offline/services/sync-retention.service';
import { SYNC_COMMAND_HANDLERS } from './core/offline/services/command-transport-router';
import {
  FinalizeQualityRouteSyncHandler,
  SaveQualityResultSyncHandler,
} from './core/offline/services/quality-control-sync.handlers';
import {
  CreateStopSyncHandler,
  DeleteStopSyncHandler,
  EndBatchSyncHandler,
  EndOperationSyncHandler,
  FinishStopSyncHandler,
  ReportBatchSyncHandler,
  ReportOperationSyncHandler,
  StartBatchSyncHandler,
  StartOperationSyncHandler,
  UpdateTeamSyncHandler,
} from './core/offline/services/fma-sync.handlers';
import { INSECURE_HTTP_TEST_MODE } from './core/runtime/insecure-http-test-mode';
import { ClientErrorHandler } from './core/logging/client-error-handler';
import { clientLogInterceptor } from './core/logging/client-log.interceptor';
import { ClientLogService } from './core/logging/client-log.service';

export type AfterRenderScheduler = (callback: () => void) => void;

export function initializeSyncRuntime(
  platformId: unknown,
  coordinator: Pick<SyncCoordinatorService, 'start'>,
  scheduleAfterRender: AfterRenderScheduler = afterNextRender,
  pwaUpdate?: Pick<PwaUpdateService, 'start'>,
  storageHealth?: Pick<StorageHealthService, 'assess'>,
  retention?: Pick<SyncRetentionService, 'cleanupCurrentOwner'>,
  clientLogs?: Pick<ClientLogService, 'capture'>,
): void {
  if (isPlatformBrowser(platformId as object)) {
    scheduleAfterRender(() => {
      pwaUpdate?.start();
      void storageHealth?.assess();
      void retention?.cleanupCurrentOwner().catch(() => {
        try {
          clientLogs?.capture({
            level: 'error',
            category: 'synchronization',
            event: 'sync_storage_failed',
            context: { stage: 'retention', code: 'STORAGE_FAILURE' },
          });
        } catch {
          // O startup e a sincronização não podem depender do sink de diagnóstico.
        }
      });
      coordinator.start();
    });
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: ClientErrorHandler },
    provideRouter(routes),
    importProvidersFrom([BrowserAnimationsModule, PoHttpRequestModule]),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch(), withInterceptors([clientLogInterceptor]), withInterceptorsFromDi()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !INSECURE_HTTP_TEST_MODE,
      registrationStrategy: 'registerWhenStable:30000',
    }),
    { provide: PoNotificationService, useClass: TopNotificationService },
    { provide: SYNC_COMMAND_HANDLERS, useClass: SaveQualityResultSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: FinalizeQualityRouteSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: StartOperationSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: ReportOperationSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: EndOperationSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: StartBatchSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: ReportBatchSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: EndBatchSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: CreateStopSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: FinishStopSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: DeleteStopSyncHandler, multi: true },
    { provide: SYNC_COMMAND_HANDLERS, useClass: UpdateTeamSyncHandler, multi: true },
    provideAppInitializer(() => {
      const coordinator = inject(SyncCoordinatorService);
      const pwaUpdate = inject(PwaUpdateService);
      const storageHealth = inject(StorageHealthService);
      const retention = inject(SyncRetentionService);
      const clientLogs = inject(ClientLogService);
      initializeSyncRuntime(
        inject(PLATFORM_ID),
        coordinator,
        afterNextRender,
        pwaUpdate,
        storageHealth,
        retention,
        clientLogs,
      );
    }),
  ],
};
