import { firstValueFrom, map, take, toArray } from 'rxjs';

import { AuthSessionService } from './auth-session.service';
import { User } from './auth.models';

const USER: User = {
  id: 'USR-001',
  nome: 'Operador Cortag',
  login: 'operador',
  permissoes: ['MENU_PRINCIPAL'],
};

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  let now: Date;

  beforeEach(() => {
    sessionStorage.clear();
    now = new Date('2026-07-29T12:00:00.000Z');
    service = new AuthSessionService(sessionStorage, () => new Date(now));
  });

  it('should start with no session', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser).toBeNull();
  });

  it('inicia uma sessão online com credencial somente em memória', () => {
    service.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    }, {
      expiresAt: '2026-07-29T20:00:00.000Z',
    });

    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser).toEqual(USER);
    expect(service.token).toBe('token-123');
    expect(service.mode).toBe('ONLINE');
    expect(JSON.parse(sessionStorage.getItem('plano-de-controle.auth-session') ?? '{}'))
      .not.toHaveProperty('token');
  });

  it('rejeita credencial remota vazia sem criar sessão', () => {
    expect(() => service.startSession(USER, '   ', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    })).toThrow('Credencial remota inválida.');

    expect(service.isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
  });

  it('should clear the session on logout', () => {
    service.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    }, {
      expiresAt: '2026-07-29T20:00:00.000Z',
    });

    service.logout();

    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser).toBeNull();
    expect(service.token).toBeNull();
  });

  it('restaura continuidade offline válida sem credencial remota', () => {
    service.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    }, {
      expiresAt: '2026-07-29T20:00:00.000Z',
    });

    const reloadedService = new AuthSessionService(sessionStorage, () => new Date(now));

    expect(reloadedService.isAuthenticated()).toBe(true);
    expect(reloadedService.currentUser).toEqual(USER);
    expect(reloadedService.token).toBeNull();
    expect(reloadedService.mode).toBe('OFFLINE');
    expect(reloadedService.hasRemoteCredential()).toBe(false);
  });

  it('não persiste continuidade sem expiração definida pelo contrato/política', () => {
    service.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    });

    expect(service.isAuthenticated()).toBe(true);
    expect(service.mode).toBe('ONLINE');
    expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
    expect(new AuthSessionService(sessionStorage, () => new Date(now)).isAuthenticated()).toBe(false);
  });

  it('descarta continuidade expirada, malformada ou de owner divergente', () => {
    const snapshots = [
      {
        version: 2,
        ownerId: USER.id,
        user: USER,
        authenticatedAt: '2026-07-29T10:00:00.000Z',
        lastValidatedAt: '2026-07-29T10:00:00.000Z',
        expiresAt: '2026-07-29T11:00:00.000Z',
      },
      {
        version: 2,
        ownerId: 'OUTRO',
        user: USER,
        authenticatedAt: '2026-07-29T10:00:00.000Z',
        lastValidatedAt: '2026-07-29T10:00:00.000Z',
        expiresAt: '2026-07-29T20:00:00.000Z',
      },
      {
        version: 2,
        ownerId: USER.id,
        user: { ...USER, permissoes: ['OK', 42] },
        authenticatedAt: '2026-07-29T10:00:00.000Z',
        lastValidatedAt: '2026-07-29T10:00:00.000Z',
        expiresAt: '2026-07-29T20:00:00.000Z',
      },
    ];

    for (const snapshot of snapshots) {
      sessionStorage.setItem('plano-de-controle.auth-session', JSON.stringify(snapshot));
      expect(new AuthSessionService(sessionStorage, () => new Date(now)).isAuthenticated()).toBe(false);
      expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
    }
  });

  it('rejeita snapshots com campos extras em vez de persistir possíveis segredos', () => {
    sessionStorage.setItem('plano-de-controle.auth-session', JSON.stringify({
      version: 2,
      ownerId: USER.id,
      user: { ...USER, refreshToken: 'segredo' },
      authenticatedAt: '2026-07-29T10:00:00.000Z',
      lastValidatedAt: '2026-07-29T10:00:00.000Z',
      expiresAt: '2026-07-29T20:00:00.000Z',
    }));

    const reloadedService = new AuthSessionService(sessionStorage, () => new Date(now));

    expect(reloadedService.isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
  });

  it('expira sessão online no prazo e notifica assinantes sem depender de getters', () => {
    let expiryCallback: (() => void) | undefined;
    const cancel = vi.fn();
    const scheduler = vi.fn((callback: () => void) => {
      expiryCallback = callback;
      return cancel;
    });
    const scheduledService = new AuthSessionService(
      sessionStorage,
      () => new Date(now),
      undefined,
      scheduler,
    );
    const emissions: Array<boolean> = [];
    scheduledService.session$.subscribe(session => emissions.push(session !== null));

    scheduledService.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T12:01:00.000Z',
    });
    expect(scheduler).toHaveBeenLastCalledWith(expect.any(Function), 60_000);

    now = new Date('2026-07-29T12:01:00.000Z');
    expiryCallback?.();

    expect(emissions).toEqual([false, true, false]);
    expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
  });

  it('expira sessão online por tokenExpiresAt mesmo sem continuidade offline', () => {
    let expiryCallback: (() => void) | undefined;
    const scheduler = vi.fn((callback: () => void) => {
      expiryCallback = callback;
      return vi.fn();
    });
    const scheduledService = new AuthSessionService(
      sessionStorage,
      () => new Date(now),
      undefined,
      scheduler,
    );

    scheduledService.startSession(
      USER,
      'token-123',
      { expiresAt: '2026-07-29T12:01:00.000Z' },
    );

    expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
    expect(scheduler).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    now = new Date('2026-07-29T12:01:00.000Z');
    expiryCallback?.();
    expect(scheduledService.isAuthenticated()).toBe(false);
    expect(scheduledService.token).toBeNull();
  });

  it('limita o snapshot offline ao prazo online', () => {
    service.startSession(
      USER,
      'token-123',
      { expiresAt: '2026-07-29T13:00:00.000Z' },
      { expiresAt: '2026-07-29T20:00:00.000Z' },
    );

    expect(JSON.parse(sessionStorage.getItem('plano-de-controle.auth-session') ?? '{}'))
      .toMatchObject({ expiresAt: '2026-07-29T13:00:00.000Z' });
  });

  it('invalida formato legado que continha token sem tentar persistir o segredo', () => {
    sessionStorage.setItem('plano-de-controle.auth-session', JSON.stringify({
      user: USER,
      token: 'segredo-legado',
      authenticatedAt: '2026-07-29T10:00:00.000Z',
    }));

    const reloadedService = new AuthSessionService(sessionStorage, () => new Date(now));

    expect(reloadedService.isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
  });

  it('should remove the persisted session on logout', () => {
    service.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    }, {
      expiresAt: '2026-07-29T20:00:00.000Z',
    });

    service.logout();

    expect(new AuthSessionService(sessionStorage, () => new Date(now)).isAuthenticated()).toBe(false);
  });

  it('should discard malformed persisted session data', () => {
    sessionStorage.setItem('plano-de-controle.auth-session', '{invalid-json');

    const reloadedService = new AuthSessionService(sessionStorage, () => new Date(now));

    expect(reloadedService.isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem('plano-de-controle.auth-session')).toBeNull();
  });

  it('should emit session changes through session$', async () => {
    const valuesPromise = firstValueFrom(
      service.session$.pipe(
        take(3),
        map(session => session !== null),
        toArray(),
      ),
    );

    service.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    });
    service.logout();

    const values = await valuesPromise;

    expect(values).toEqual([false, true, false]);
  });

  it('should not emit duplicate null on repeated logout', async () => {
    const emissions: Array<boolean> = [];
    const subscription = service.session$.pipe(map(s => s !== null)).subscribe(v => emissions.push(v));

    service.startSession(USER, 'token-123', {
      expiresAt: '2026-07-29T20:00:00.000Z',
    });
    service.logout();
    service.logout();

    subscription.unsubscribe();

    expect(emissions).toEqual([false, true, false]);
  });
});
