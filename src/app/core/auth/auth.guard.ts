import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { AuthSessionService } from './auth-session.service';
import { buildSafeReturnUrl } from './safe-return-url';
import type { AppPermission } from '../../../app-permissions';

/**
 * Route guard that protects private routes from unauthenticated access.
 *
 * When the user is authenticated, navigation is allowed. Otherwise the guard
 * redirects to `/login` preserving the originally requested internal path as
 * `returnUrl` so the login page can send the user back after a successful
 * authentication.
 *
 * The `returnUrl` is sanitized through `buildSafeReturnUrl`, the same helper
 * used by `LoginPage`, so both enforcement points share identical rules.
 */
export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): boolean | UrlTree => {
  const session = inject(AuthSessionService);
  const router = inject(Router);

  if (session.isAuthenticated()) {
    const requiredPermission = route.data?.['requiredPermission'] as AppPermission | undefined;
    if (!requiredPermission
      || session.currentUser?.permissoes.includes(requiredPermission)) {
      return true;
    }
    return router.createUrlTree(['/menu'], {
      queryParams: { accessDenied: '1' },
    });
  }

  const safeReturnUrl = buildSafeReturnUrl(state.url);

  return router.createUrlTree(['/login'], {
    queryParams: safeReturnUrl ? { returnUrl: safeReturnUrl } : {},
  });
};
