import { Routes } from '@angular/router';

import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';

export const routes: Routes = [
  { path: 'quality-control', component: QualityControlHome },
  { path: '', pathMatch: 'full', redirectTo: 'quality-control' },
  { path: '**', redirectTo: 'quality-control' },
];
