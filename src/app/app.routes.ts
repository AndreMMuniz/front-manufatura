import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'quality-control', component: QualityControlHome, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'quality-control' },
  { path: '**', redirectTo: 'quality-control' },
];
