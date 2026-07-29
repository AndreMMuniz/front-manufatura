import { describe, expect, it, vi } from 'vitest';

import { initializeSyncRuntime } from './app.config';

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
});
