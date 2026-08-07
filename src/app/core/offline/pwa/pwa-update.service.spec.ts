import { Subject } from 'rxjs';
import { signal } from '@angular/core';
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

  it('encerra checking quando não existe nova versão', async () => {
    const { service } = setup();

    service.start();
    await Promise.resolve();

    expect(service.state()).toEqual({ status: 'up-to-date' });
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

  it('recarrega somente por pedido explícito e com versão pronta', async () => {
    const { service, versionUpdates, browserReload } = setup();
    service.start();

    await expect(service.reloadWhenSafe()).resolves.toBe('not-ready');
    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'v1' },
      latestVersion: { hash: 'v2' },
    });
    await expect(service.reloadWhenSafe()).resolves.toBe('reloaded');
    expect(browserReload.reload).toHaveBeenCalledOnce();
  });

  it('bloqueia captura ativa e exige confirmação explícita para Outbox pendente', async () => {
    const versionUpdates = new Subject<unknown>();
    const activeCapture = signal(true);
    const workState = { hasActiveCapture: activeCapture.asReadonly() };
    const service = new PwaUpdateService(
      {
        isEnabled: true,
        versionUpdates,
        unrecoverable: new Subject(),
        checkForUpdate: vi.fn().mockResolvedValue(false),
      },
      { reload: vi.fn() },
      { currentUser: { id: 'owner-1', nome: 'Operador', login: 'op', permissoes: [] } },
      {
        listByOwner: vi.fn().mockResolvedValue([
          { status: 'PENDING' },
        ]),
      } as never,
      workState,
    );
    service.start();
    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'v1' },
      latestVersion: { hash: 'v2' },
    });

    await expect(service.reloadWhenSafe()).resolves.toBe('capture-active');

    activeCapture.set(false);
    await expect(service.reloadWhenSafe()).resolves.toBe('pending-outbox');
    await expect(service.reloadWhenSafe(true)).resolves.toBe('reloaded');
  });
});
