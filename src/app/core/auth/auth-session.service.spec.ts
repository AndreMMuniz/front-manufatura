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

  it('should return false (not throw) on null/undefined inputs', () => {
    expect(service.login(null as unknown as string, 'mock123')).toBe(false);
    expect(service.login('operador', undefined as unknown as string)).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
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

  it('should not emit duplicate null on repeated logout', async () => {
    const emissions: Array<boolean> = [];
    const subscription = service.session$.pipe(map(s => s !== null)).subscribe(v => emissions.push(v));

    service.login('operador', 'mock123');
    service.logout();
    service.logout();

    subscription.unsubscribe();

    expect(emissions).toEqual([false, true, false]);
  });
});
