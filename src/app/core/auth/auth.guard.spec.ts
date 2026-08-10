import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from './auth-session.service';
import { authGuard } from './auth.guard';
import { APP_PERMISSIONS } from '../../../app-permissions';

describe('authGuard', () => {
  function setup(authenticated: boolean, permissions: string[] = []) {
    const sessionService = {
      isAuthenticated: vi.fn().mockReturnValue(authenticated),
      currentUser: authenticated
        ? { id: 'operador', nome: 'Operador', login: 'operador', permissoes: permissions }
        : null,
    } as unknown as AuthSessionService;

    const router = {
      createUrlTree: vi
        .fn()
        .mockImplementation((commands, extras) => ({ commands, extras }) as unknown as UrlTree),
    } as unknown as Router;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: sessionService },
        { provide: Router, useValue: router },
      ],
    });

    return { sessionService, router };
  }

  async function runGuard(url: string, requiredPermission?: string): Promise<boolean | UrlTree> {
    const routeSnapshot = {
      data: requiredPermission ? { requiredPermission } : {},
    } as never;
    const state = { url } as never;

    return TestBed.runInInjectionContext(() => authGuard(routeSnapshot, state)) as Promise<boolean | UrlTree>;
  }

  it('allows navigation when the user is authenticated', async () => {
    setup(true);

    const result = await runGuard('/quality-control');

    expect(result).toBe(true);
  });

  it('permite somente rota de módulo autorizada', async () => {
    setup(true, [APP_PERMISSIONS.operationReporting]);

    expect(await runGuard('/operation-reporting', APP_PERMISSIONS.operationReporting)).toBe(true);
  });

  it('bloqueia deep link de módulo sem permissão e volta ao menu', async () => {
    const { router } = setup(true, [APP_PERMISSIONS.operationReporting]);

    const result = await runGuard('/quality-control', APP_PERMISSIONS.qualityControl);

    expect(router.createUrlTree).toHaveBeenCalledWith(['/menu'], {
      queryParams: { accessDenied: '1' },
    });
    expect(result).toBe(vi.mocked(router.createUrlTree).mock.results[0].value);
  });

  it('redirects to /login with returnUrl when the user is not authenticated', async () => {
    const { router } = setup(false);

    const result = await runGuard('/quality-control');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/quality-control' },
    });
    expect(result).toBe(vi.mocked(router.createUrlTree).mock.results[0].value);
  });

  it('decodes encoded returnUrl before forwarding', async () => {
    const { router } = setup(false);

    const result = await runGuard('/quality-control%2Freports');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/quality-control/reports' },
    });
    expect(result).toBe(vi.mocked(router.createUrlTree).mock.results[0].value);
  });

  it.each([
    ['https://evil.example/path'],
    ['//evil.example/path'],
    ['/%2F%2Fevil.example'],
    ['/%252F%252Fevil.example'],
    ['/login'],
    ['/Login'],
    ['/LOGIN'],
    ['/login/foo'],
  ])('rejects unsafe returnUrl %s and omits it from the redirect', async returnUrl => {
    const { router } = setup(false);

    const result = await runGuard(returnUrl);

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: {} });
    expect(result).toBe(vi.mocked(router.createUrlTree).mock.results[0].value);
  });

  it.each(['/loginhelp', '/login-support'])('accepts safe internal path %s whose first segment is not "login"', async returnUrl => {
    const { router } = setup(false);

    const result = await runGuard(returnUrl);

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl } });
    expect(result).toBe(vi.mocked(router.createUrlTree).mock.results[0].value);
  });
});
