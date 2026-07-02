import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { EquipesPage } from './features/equipes/pages/equipes-page/equipes-page';
import { MainMenuPage } from './features/shop-floor/pages/main-menu/main-menu';
import { OperatorsPage } from './features/shop-floor/pages/operators/operators';
import { SfcPlaceholderPage } from './features/shop-floor/pages/sfc-placeholder/sfc-placeholder';
import { WorkCenterPage } from './features/shop-floor/pages/work-center/work-center';
import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';
import { ExamEntryPage } from './features/quality-control/pages/exam-entry/exam-entry';
import { RouteGenerationPage } from './features/quality-control/pages/route-generation/route-generation';
import { ReportOperacaoPage } from './features/report-operacao/pages/report-operacao-page/report-operacao-page';
import { ReporteParadasPage } from './features/reporte-paradas/pages/reporte-paradas-page/reporte-paradas-page';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'menu', component: MainMenuPage, canActivate: [authGuard] },
  { path: 'work-center', component: WorkCenterPage, canActivate: [authGuard] },
  { path: 'operators', component: OperatorsPage, canActivate: [authGuard] },
  {
    path: 'teams',
    component: EquipesPage,
    canActivate: [authGuard],
  },
  {
    path: 'operation-reporting',
    component: ReportOperacaoPage,
    canActivate: [authGuard],
  },
  {
    path: 'stoppages',
    component: ReporteParadasPage,
    canActivate: [authGuard],
  },
  {
    path: 'scrap-rework',
    component: SfcPlaceholderPage,
    canActivate: [authGuard],
    data: {
      title: 'Refugo / Retrabalho',
      description: 'Fluxos de apontamento de refugo e retrabalho serao implementados em uma etapa futura.',
    },
  },
  {
    path: 'item-consultation',
    component: SfcPlaceholderPage,
    canActivate: [authGuard],
    data: {
      title: 'Consulta Item',
      description: 'A consulta de itens sera implementada em uma etapa futura.',
    },
  },
  { path: 'quality-control', component: RouteGenerationPage, canActivate: [authGuard] },
  { path: 'quality-control/inspection', component: QualityControlHome, canActivate: [authGuard] },
  { path: 'quality-control/exam-entry', component: ExamEntryPage, canActivate: [authGuard] },
  // Empty root redirects to /menu (which is guarded) so the auth
  // round-trip still lands authenticated users at the SFC main menu and
  // anonymous users are forwarded to /login with returnUrl=/menu.
  { path: '', pathMatch: 'full', redirectTo: 'menu' },
  // `**` is guarded (rather than redirecting to /quality-control) so that
  // deep-links preserve their original URL as `returnUrl` through the auth
  // round-trip instead of being collapsed to /quality-control.
  {
    path: '**',
    component: SfcPlaceholderPage,
    canActivate: [authGuard],
    data: {
      title: 'Funcionalidade não encontrada',
      description: 'Acesse uma opção disponível pelo menu principal.',
    },
  },
];
