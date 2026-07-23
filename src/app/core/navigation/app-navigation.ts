export interface AppNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: string;
  readonly route: string;
}

const modules = [
  {
    id: 'quality-control',
    label: 'Plano Controle CQ',
    shortLabel: 'CQ',
    icon: 'an an-flask',
    route: '/quality-control',
  },
  {
    id: 'operation-reporting',
    label: 'Reporte Ordem',
    shortLabel: 'Reporte',
    icon: 'an an-factory',
    route: '/operation-reporting',
  },
  {
    id: 'batch-reporting',
    label: 'Reporte Batelada',
    shortLabel: 'Batelada',
    icon: 'an an-stack',
    route: '/batch-reporting',
  },
  {
    id: 'stoppages',
    label: 'Paradas',
    shortLabel: 'Paradas',
    icon: 'an an-warning',
    route: '/stoppages',
  },
  {
    id: 'scrap-rework',
    label: 'Refugo / Retrabalho',
    shortLabel: 'Refugo',
    icon: 'an an-arrows-clockwise',
    route: '/scrap-rework',
  },
  {
    id: 'work-center',
    label: 'Centro de Trabalho',
    shortLabel: 'Centro',
    icon: 'an an-monitor',
    route: '/work-center',
  },
  {
    id: 'operators',
    label: 'Operador',
    shortLabel: 'Operador',
    icon: 'an an-user',
    route: '/operators',
  },
  {
    id: 'teams',
    label: 'Equipes',
    shortLabel: 'Equipes',
    icon: 'an an-users',
    route: '/teams',
  },
] satisfies ReadonlyArray<AppNavigationItem>;

export const APP_MODULE_NAVIGATION: ReadonlyArray<AppNavigationItem> = Object.freeze(
  modules.map(item => Object.freeze({ ...item })),
);
