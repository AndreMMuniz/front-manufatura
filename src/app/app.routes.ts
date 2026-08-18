import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { OFFLINE_TEST_ROUTES } from './core/offline/testing/offline-test.routes';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { EquipesPage } from './features/equipes/pages/equipes-page/equipes-page';
import { OperatorsPage } from './features/shop-floor/pages/operators/operators';
import { MainMenuPage } from './features/shop-floor/pages/main-menu/main-menu';
import { SfcPlaceholderPage } from './features/shop-floor/pages/sfc-placeholder/sfc-placeholder';
import { WorkCenterPage } from './features/shop-floor/pages/work-center/work-center';
import { ReportOperacaoPage } from './features/report-operacao/pages/report-operacao-page/report-operacao-page';
import { ReportaBateladaPage } from './features/reporta-batelada/pages/reporta-batelada-page/reporta-batelada-page';
import { ReporteParadasPage } from './features/reporte-paradas/pages/reporte-paradas-page/reporte-paradas-page';
import { APP_PERMISSIONS } from '../app-permissions';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  ...OFFLINE_TEST_ROUTES,
  { path: 'menu', component: MainMenuPage, canActivate: [authGuard] },
  {
    path: 'work-center', component: WorkCenterPage, canActivate: [authGuard],
    data: { requiredPermission: APP_PERMISSIONS.operationReporting },
  },
  {
    path: 'operators', component: OperatorsPage, canActivate: [authGuard],
    data: { requiredPermission: APP_PERMISSIONS.operationReporting },
  },
  {
    path: 'teams',
    component: EquipesPage,
    canActivate: [authGuard],
    data: { requiredPermission: APP_PERMISSIONS.operationReporting },
  },
  {
    path: 'operation-reporting',
    component: ReportOperacaoPage,
    canActivate: [authGuard],
    data: { requiredPermission: APP_PERMISSIONS.operationReporting },
  },
  {
    path: 'batch-reporting',
    component: ReportaBateladaPage,
    canActivate: [authGuard],
    data: { requiredPermission: APP_PERMISSIONS.batchReporting },
  },
  {
    path: 'stoppages',
    component: ReporteParadasPage,
    canActivate: [authGuard],
    data: { requiredPermission: APP_PERMISSIONS.stoppages },
  },
  {
    path: 'scrap-rework',
    component: ReportOperacaoPage,
    canActivate: [authGuard],
    data: {
      auxiliaryFlow: 'refugo',
      requiredPermission: APP_PERMISSIONS.operationReporting,
    },
  },
  {
    path: 'item-consultation',
    component: SfcPlaceholderPage,
    canActivate: [authGuard],
    data: {
      title: 'Consulta Item',
      description: 'A consulta de itens sera implementada em uma etapa futura.',
      requiresOnlineData: true,
    },
  },
  { path: 'quality-control/inspection', pathMatch: 'full', redirectTo: 'quality-control' },
  { path: 'quality-control/exam-entry', pathMatch: 'full', redirectTo: 'quality-control' },
  {
    path: 'quality-control/route-authorization',
    loadComponent: () => import(
      './features/route-authorization/pages/route-authorization-page/route-authorization-page'
    ).then(module => module.RouteAuthorizationPage),
    canActivate: [authGuard],
    data: {
      requiresOnlineData: true,
      requiredPermission: APP_PERMISSIONS.divergentRouteAuthorization,
    },
  },
  {
    path: 'quality-control',
    loadComponent: () => import('./features/quality-control/pages/quality-control-workspace/quality-control-workspace')
      .then(module => module.QualityControlWorkspacePage),
    canActivate: [authGuard],
    data: { requiredPermission: APP_PERMISSIONS.qualityControl },
  },
  {
    path: 'synchronization',
    loadComponent: () => import(
      './features/synchronization/pages/synchronization-center/synchronization-center'
    ).then(module => module.SynchronizationCenterPage),
    canActivate: [authGuard],
  },
  // Empty root redirects to the authenticated Home.
  { path: '', pathMatch: 'full', redirectTo: 'menu' },
  // `**` is guarded (rather than redirecting to /menu) so that
  // deep-links preserve their original URL as `returnUrl` through the auth
  // round-trip instead of being collapsed to /menu.
  {
    path: '**',
    component: SfcPlaceholderPage,
    canActivate: [authGuard],
    data: {
      title: 'Funcionalidade não encontrada',
      description: 'Acesse uma opção disponível pelo menu lateral.',
    },
  },
];
