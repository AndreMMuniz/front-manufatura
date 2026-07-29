import { describe, expect, it, vi } from 'vitest';

import { initializeSyncRuntime } from './app.config';
import { routes } from './app.routes';
import { OFFLINE_TEST_ROUTES as E2E_ROUTES } from './core/offline/testing/offline-test.routes.e2e';

describe('appConfig sync bootstrap', () => {
  it('não agenda nem inicia sincronização no SSR', () => {
    const coordinator = { start: vi.fn() };
    const pwaUpdate = { start: vi.fn() };
    const storageHealth = { assess: vi.fn() };
    const scheduleAfterRender = vi.fn();

    initializeSyncRuntime('server', coordinator, scheduleAfterRender, pwaUpdate, storageHealth);

    expect(scheduleAfterRender).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(pwaUpdate.start).not.toHaveBeenCalled();
    expect(storageHealth.assess).not.toHaveBeenCalled();
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
    const scheduleAfterRender = vi.fn((callback: () => void) => callback());

    initializeSyncRuntime('browser', coordinator, scheduleAfterRender, pwaUpdate, storageHealth);

    expect(scheduleAfterRender).toHaveBeenCalledOnce();
    expect(pwaUpdate.start).toHaveBeenCalledOnce();
    expect(storageHealth.assess).toHaveBeenCalledOnce();
    expect(coordinator.start).toHaveBeenCalledOnce();
    expect(order).toEqual(['pwa', 'storage', 'sync']);
  });

  it('mantém harnesses fora das rotas padrão e os habilita apenas na configuração E2E', () => {
    expect(routes.some((route) => route.path?.startsWith('_test/'))).toBe(false);
    expect(E2E_ROUTES.map((route) => route.path)).toEqual([
      '_test/offline-persistence',
      '_test/offline-synchronization',
      '_test/pwa-offline',
    ]);
  });
});
