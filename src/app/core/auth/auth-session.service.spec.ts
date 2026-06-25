import { firstValueFrom, map, take, toArray } from 'rxjs';

import { AuthSessionService } from './auth-session.service';

describe('AuthSessionService', () => {
  let service: AuthSessionService;

  beforeEach(() => {
    service = new AuthSessionService();
  });

  it('should start with no session', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser).toBeNull();
  });

  it('should authenticate with valid mock credentials', () => {
    const result = service.login('operador', 'mock123');

    expect(result).toBe(true);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser).toEqual({ username: 'operador' });
  });

  it('should reject invalid credentials without creating a session', () => {
    const result = service.login('operador', 'wrong');

    expect(result).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser).toBeNull();
  });

  it('should trim username and password before validating', () => {
    const result = service.login('  operador  ', '  mock123  ');

    expect(result).toBe(true);
    expect(service.currentUser).toEqual({ username: 'operador' });
  });

  it('should clear the session on logout', () => {
    service.login('operador', 'mock123');

    service.logout();

    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser).toBeNull();
  });

  it('should emit session changes through session$', async () => {
    const valuesPromise = firstValueFrom(
      service.session$.pipe(
        take(3),
        map(session => session !== null),
        toArray(),
      ),
    );

    service.login('operador', 'mock123');
    service.logout();

    const values = await valuesPromise;

    expect(values).toEqual([false, true, false]);
  });
});
