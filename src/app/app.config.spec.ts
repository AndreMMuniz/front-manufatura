import { describe, expect, it, vi } from 'vitest';

import { initializeSyncRuntime } from './app.config';
import { routes } from './app.routes';
import { OFFLINE_TEST_ROUTES as E2E_ROUTES } from './core/offline/testing/offline-test.routes.e2e';

describe('appConfig sync bootstrap', () => {
  it('não agenda nem inicia sincronização no SSR', () => {
    const coordinator = { start: vi.fn() };
    const scheduleAfterRender = vi.fn();

    initializeSyncRuntime('server', coordinator, scheduleAfterRender);

    expect(scheduleAfterRender).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
  });

  it('inicia somente depois da renderização no browser', () => {
    const coordinator = { start: vi.fn() };
    const scheduleAfterRender = vi.fn((callback: () => void) => callback());

    initializeSyncRuntime('browser', coordinator, scheduleAfterRender);

    expect(scheduleAfterRender).toHaveBeenCalledOnce();
    expect(coordinator.start).toHaveBeenCalledOnce();
  });

  it('mantém harnesses fora das rotas padrão e os habilita apenas na configuração E2E', () => {
    expect(routes.some((route) => route.path?.startsWith('_test/'))).toBe(false);
    expect(E2E_ROUTES.map((route) => route.path)).toEqual([
      '_test/offline-persistence',
      '_test/offline-synchronization',
    ]);
  });
});
