import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { AuthSessionService } from './auth-session.service';

/**
 * Route guard that protects private routes from unauthenticated access.
 *
 * When the user is authenticated, navigation is allowed. Otherwise the guard
 * redirects to `/login` preserving the originally requested internal path as
 * `returnUrl` so the login page can send the user back after a successful
 * authentication.
 *
 * The `returnUrl` is sanitized with the same rules used by `LoginPage`:
 * - Only internal paths starting with `/` are accepted.
 * - Protocol-relative URLs (`//...`) are rejected.
 * - `/login` is rejected to avoid redirect loops.
 * - Malformed/encoded values are decoded before validation.
 */
export const authGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): boolean | UrlTree => {
  const session = inject(AuthSessionService);
  const router = inject(Router);

  if (session.isAuthenticated()) {
    return true;
  }

  const returnUrl = state.url;
  const safeReturnUrl = buildSafeReturnUrl(returnUrl);

  return router.createUrlTree(['/login'], {
    queryParams: safeReturnUrl ? { returnUrl: safeReturnUrl } : {},
  });
};

function buildSafeReturnUrl(returnUrl: string): string | null {
  if (!returnUrl || !returnUrl.startsWith('/')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(returnUrl);
  } catch {
    return null;
  }

  if (decoded.startsWith('//') || decoded.startsWith('/login')) {
    return null;
  }

  return returnUrl;
}
