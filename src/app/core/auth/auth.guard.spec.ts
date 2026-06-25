import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from './auth-session.service';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  function setup(authenticated: boolean) {
    const sessionService = {
      isAuthenticated: vi.fn().mockReturnValue(authenticated),
    } as unknown as AuthSessionService;

    const router = {
      createUrlTree: vi.fn().mockImplementation((commands, extras) => ({
        commands,
        extras,
      })),
      parseUrl: vi.fn().mockImplementation(url => ({ path: url })),
    } as unknown as Router;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: sessionService },
        { provide: Router, useValue: router },
      ],
    });

    return { sessionService, router };
  }

  async function runGuard(url: string): Promise<boolean | UrlTree> {
    const routeSnapshot = { url: [] } as never;
    const state = { url } as never;

    return TestBed.runInInjectionContext(() => authGuard(routeSnapshot, state)) as Promise<boolean | UrlTree>;
  }

  it('allows navigation when the user is authenticated', async () => {
    setup(true);

    const result = await runGuard('/quality-control');

    expect(result).toBe(true);
  });

  it('redirects to /login with returnUrl when the user is not authenticated', async () => {
    const { router } = setup(false);

    const result = (await runGuard('/quality-control')) as unknown as UrlTree;

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/quality-control' } });
    expect(result).toBeDefined();
  });

  it('rejects an unsafe returnUrl and omits it from the redirect', async () => {
    const { router } = setup(false);

    await runGuard('https://evil.example/path');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: {} });
  });

  it('rejects protocol-relative returnUrl and omits it', async () => {
    const { router } = setup(false);

    await runGuard('//evil.example/path');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: {} });
  });

  it('rejects /login as returnUrl to avoid redirect loops', async () => {
    const { router } = setup(false);

    await runGuard('/login');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: {} });
  });
});
