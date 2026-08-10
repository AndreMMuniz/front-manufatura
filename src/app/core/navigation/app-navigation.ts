import { APP_PERMISSIONS, type AppPermission } from '../../../app-permissions';

export interface AppNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: string;
  readonly route: string;
  readonly permission: AppPermission;
}

const modules = [
  {
    id: 'quality-control',
    label: 'Plano Controle CQ',
    shortLabel: 'CQ',
    icon: 'an an-flask',
    route: '/quality-control',
    permission: APP_PERMISSIONS.qualityControl,
  },
  {
    id: 'operation-reporting',
    label: 'Reporte Ordem',
    shortLabel: 'Reporte',
    icon: 'an an-factory',
    route: '/operation-reporting',
    permission: APP_PERMISSIONS.operationReporting,
  },
  {
    id: 'batch-reporting',
    label: 'Reporte Batelada',
    shortLabel: 'Batelada',
    icon: 'an an-stack',
    route: '/batch-reporting',
    permission: APP_PERMISSIONS.batchReporting,
  },
  {
    id: 'stoppages',
    label: 'Paradas',
    shortLabel: 'Paradas',
    icon: 'an an-warning',
    route: '/stoppages',
    permission: APP_PERMISSIONS.stoppages,
  },
] satisfies ReadonlyArray<AppNavigationItem>;

export const APP_MODULE_NAVIGATION: ReadonlyArray<AppNavigationItem> = Object.freeze(
  modules.map(item => Object.freeze({ ...item })),
);

export function navigationForPermissions(
  permissions: readonly string[],
): ReadonlyArray<AppNavigationItem> {
  const allowed = new Set(permissions);
  return APP_MODULE_NAVIGATION.filter(item => allowed.has(item.permission));
}
