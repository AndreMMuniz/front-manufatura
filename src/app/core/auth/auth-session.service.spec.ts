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

  beforeEach(() => {
    sessionStorage.clear();
    service = new AuthSessionService();
  });

  it('should start with no session', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser).toBeNull();
  });

  it('should start a session with user and token', () => {
    service.startSession(USER, 'token-123');

    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser).toEqual(USER);
    expect(service.token).toBe('token-123');
  });

  it('should clear the session on logout', () => {
    service.startSession(USER, 'token-123');

    service.logout();

    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser).toBeNull();
    expect(service.token).toBeNull();
  });

  it('should restore the authenticated session after the application reloads', () => {
    service.startSession(USER, 'token-123');

    const reloadedService = new AuthSessionService();

    expect(reloadedService.isAuthenticated()).toBe(true);
    expect(reloadedService.currentUser).toEqual(USER);
    expect(reloadedService.token).toBe('token-123');
  });

  it('should remove the persisted session on logout', () => {
    service.startSession(USER, 'token-123');

    service.logout();

    expect(new AuthSessionService().isAuthenticated()).toBe(false);
  });

  it('should discard malformed persisted session data', () => {
    sessionStorage.setItem('plano-de-controle.auth-session', '{invalid-json');

    const reloadedService = new AuthSessionService();

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

    service.startSession(USER, 'token-123');
    service.logout();

    const values = await valuesPromise;

    expect(values).toEqual([false, true, false]);
  });

  it('should not emit duplicate null on repeated logout', async () => {
    const emissions: Array<boolean> = [];
    const subscription = service.session$.pipe(map(s => s !== null)).subscribe(v => emissions.push(v));

    service.startSession(USER, 'token-123');
    service.logout();
    service.logout();

    subscription.unsubscribe();

    expect(emissions).toEqual([false, true, false]);
  });
});
