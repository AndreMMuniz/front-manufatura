import { ErrorHandler, type StaticProvider } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { appConfig, initializeSyncRuntime } from './app.config';
import { routes } from './app.routes';
import { ClientErrorHandler } from './core/logging/client-error-handler';
import { OFFLINE_TEST_ROUTES as E2E_ROUTES } from './core/offline/testing/offline-test.routes.e2e';

describe('appConfig sync bootstrap', () => {
  it('não agenda nem inicia sincronização no SSR', () => {
    const coordinator = { start: vi.fn() };
    const pwaUpdate = { start: vi.fn() };
    const storageHealth = { assess: vi.fn() };
    const retention = { cleanupCurrentOwner: vi.fn() };
    const scheduleAfterRender = vi.fn();

    initializeSyncRuntime(
      'server', coordinator, scheduleAfterRender, pwaUpdate, storageHealth, retention,
    );

    expect(scheduleAfterRender).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(pwaUpdate.start).not.toHaveBeenCalled();
    expect(storageHealth.assess).not.toHaveBeenCalled();
    expect(retention.cleanupCurrentOwner).not.toHaveBeenCalled();
  });

  it('inicia PWA antes do sincronizador e somente depois da renderização no browser', () => {
    const order: string[] = [];
    const coordinator = { start: vi.fn() };
    coordinator.start.mockImplementation(() => order.push('sync'));
    const pwaUpdate = { start: vi.fn(() => order.push('pwa')) };
    const storageHealth = {
      assess: vi.fn(() => {
        order.push('storage');
        return Promise.resolve();
      }),
    };
    const retention = {
      cleanupCurrentOwner: vi.fn(() => {
        order.push('retention');
        return Promise.resolve(null);
      }),
    };
    const scheduleAfterRender = vi.fn((callback: () => void) => callback());

    initializeSyncRuntime(
      'browser', coordinator, scheduleAfterRender, pwaUpdate, storageHealth, retention,
    );

    expect(scheduleAfterRender).toHaveBeenCalledOnce();
    expect(pwaUpdate.start).toHaveBeenCalledOnce();
    expect(storageHealth.assess).toHaveBeenCalledOnce();
    expect(retention.cleanupCurrentOwner).toHaveBeenCalledOnce();
    expect(coordinator.start).toHaveBeenCalledOnce();
    expect(order).toEqual(['pwa', 'storage', 'retention', 'sync']);
  });

  it('absorve falha da retenção no startup e ainda inicia o sincronizador', async () => {
    const coordinator = { start: vi.fn() };
    const clientLogs = { capture: vi.fn() };
    const retention = {
      cleanupCurrentOwner: vi.fn().mockRejectedValue(new Error('owner-1 payload segredo')),
    };
    const scheduleAfterRender = vi.fn((callback: () => void) => callback());

    initializeSyncRuntime(
      'browser', coordinator, scheduleAfterRender, undefined, undefined, retention, clientLogs,
    );
    await Promise.resolve();

    expect(coordinator.start).toHaveBeenCalledOnce();
    expect(clientLogs.capture).toHaveBeenCalledWith({
      level: 'error',
      category: 'synchronization',
      event: 'sync_storage_failed',
      context: { stage: 'retention', code: 'STORAGE_FAILURE' },
    });
    expect(JSON.stringify(clientLogs.capture.mock.calls)).not.toMatch(/owner-1|payload|segredo/);
  });

  it('mantém harnesses fora das rotas padrão e os habilita apenas na configuração E2E', () => {
    expect(routes.some((route) => route.path?.startsWith('_test/'))).toBe(false);
    expect(E2E_ROUTES.map((route) => route.path)).toEqual([
      '_test/offline-persistence',
      '_test/offline-synchronization',
      '_test/pwa-offline',
    ]);
  });

  it('registra um único ErrorHandler central sem remover o listener global do Angular', () => {
    const providers = appConfig.providers as StaticProvider[];
    const errorHandlers = providers.filter(provider =>
      typeof provider === 'object' && provider !== null && 'provide' in provider
      && provider.provide === ErrorHandler);

    expect(errorHandlers).toEqual([{ provide: ErrorHandler, useClass: ClientErrorHandler }]);
  });
});
