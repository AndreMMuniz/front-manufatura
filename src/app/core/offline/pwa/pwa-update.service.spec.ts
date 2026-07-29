import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  BrowserReload,
  PwaUpdateService,
  SwUpdateFacade,
} from './pwa-update.service';

describe('PwaUpdateService', () => {
  function setup(enabled = true) {
    const versionUpdates = new Subject<unknown>();
    const unrecoverable = new Subject<{ reason: string }>();
    const swUpdate: SwUpdateFacade = {
      isEnabled: enabled,
      versionUpdates,
      unrecoverable,
      checkForUpdate: vi.fn().mockResolvedValue(false),
    };
    const browserReload: BrowserReload = { reload: vi.fn() };
    const service = new PwaUpdateService(swUpdate, browserReload);

    return { service, swUpdate, versionUpdates, unrecoverable, browserReload };
  }

  it('permanece desabilitado sem suporte e não consulta atualização', () => {
    const { service, swUpdate } = setup(false);

    service.start();

    expect(service.state()).toEqual({ status: 'disabled' });
    expect(swUpdate.checkForUpdate).not.toHaveBeenCalled();
  });

  it('expõe checking e ready sem ativar nem recarregar automaticamente', async () => {
    const { service, swUpdate, versionUpdates, browserReload } = setup();

    service.start();
    versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'v2' } });
    expect(service.state()).toEqual({ status: 'checking', versionHash: 'v2' });

    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'v1' },
      latestVersion: { hash: 'v2' },
    });

    expect(service.state()).toEqual({
      status: 'ready',
      currentVersionHash: 'v1',
      versionHash: 'v2',
    });
    expect(browserReload.reload).not.toHaveBeenCalled();
    expect('activateUpdate' in swUpdate).toBe(false);
  });

  it.each(['VERSION_INSTALLATION_FAILED', 'VERSION_FAILED'])(
    'representa %s como falha de instalação sanitizada',
    (type) => {
      const { service, versionUpdates } = setup();
      service.start();

      versionUpdates.next({
        type,
        version: { hash: 'v2' },
        error: 'chunk indisponível',
      });

      expect(service.state()).toEqual({
        status: 'install-failed',
        versionHash: 'v2',
        message: 'Não foi possível preparar a atualização.',
      });
    },
  );

  it('representa estado irrecuperável e exige ação explícita', () => {
    const { service, unrecoverable, browserReload } = setup();
    service.start();

    unrecoverable.next({ reason: 'cache inconsistente' });

    expect(service.state()).toEqual({
      status: 'unrecoverable',
      message: 'A aplicação precisa ser recarregada com conexão para se recuperar.',
    });
    expect(browserReload.reload).not.toHaveBeenCalled();
  });

  it('recarrega somente por pedido explícito, com versão pronta e em momento seguro', () => {
    const { service, versionUpdates, browserReload } = setup();
    service.start();

    expect(service.reloadWhenSafe(true)).toBe(false);
    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'v1' },
      latestVersion: { hash: 'v2' },
    });
    expect(service.reloadWhenSafe(false)).toBe(false);
    expect(service.reloadWhenSafe(true)).toBe(true);
    expect(browserReload.reload).toHaveBeenCalledOnce();
  });
});
