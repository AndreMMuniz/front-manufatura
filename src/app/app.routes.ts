import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { MainMenuPage } from './features/shop-floor/pages/main-menu/main-menu';
import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'menu', component: MainMenuPage, canActivate: [authGuard] },
  { path: 'quality-control', component: QualityControlHome, canActivate: [authGuard] },
  // Empty root redirects to /menu (which is guarded) so the auth
  // round-trip still lands authenticated users at the SFC main menu and
  // anonymous users are forwarded to /login with returnUrl=/menu.
  { path: '', pathMatch: 'full', redirectTo: 'menu' },
  // `**` is guarded (rather than redirecting to /quality-control) so that
  // deep-links preserve their original URL as `returnUrl` through the auth
  // round-trip instead of being collapsed to /quality-control.
  { path: '**', component: QualityControlHome, canActivate: [authGuard] },
];
