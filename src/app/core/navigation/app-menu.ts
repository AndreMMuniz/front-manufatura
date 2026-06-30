export interface MenuOption {
  readonly id: string;
  readonly label: string;
  readonly target?: string;
  readonly implemented: boolean;
}

export interface MenuGroup {
  readonly id: string;
  readonly label: string;
  readonly options: ReadonlyArray<MenuOption>;
}

const menu = [
  {
    id: 'producao',
    label: 'Produção',
    options: [
      { id: 'iniciar-ordem', label: 'Iniciar Ordem', target: '/operation-reporting', implemented: true },
      { id: 'iniciar-ordem-batelada', label: 'Iniciar Ordem Batelada', target: '/operation-reporting', implemented: true },
      { id: 'reporte-ordem', label: 'Reporte Ordem', target: '/operation-reporting', implemented: true },
      { id: 'reporte-batelada', label: 'Reporte Batelada', target: '/operation-reporting', implemented: true },
      { id: 'inicio-de-parada', label: 'Início de Parada', target: '/stoppages', implemented: true },
      { id: 'encerrar-parada', label: 'Encerrar Parada', target: '/stoppages', implemented: true },
      { id: 'parada-programada', label: 'Parada Programada', target: '/stoppages', implemented: true },
      { id: 'apontar-refugo', label: 'Apontar Refugo', target: '/scrap-rework', implemented: true },
      { id: 'lista-de-paradas', label: 'Lista de Paradas', target: '/stoppages', implemented: true },
    ],
  },
  {
    id: 'apontamento',
    label: 'Apontamento',
    options: [
      { id: 'iniciar-ordens', label: 'Iniciar Ordens', target: '/operation-reporting', implemented: true },
      { id: 'reporte', label: 'Reporte Operações', target: '/operation-reporting', implemented: true },
      { id: 'inicio-de-parada-ap', label: 'Início de Parada', target: '/stoppages', implemented: true },
      { id: 'encerrar-parada-ap', label: 'Encerrar Parada', target: '/stoppages', implemented: true },
      { id: 'apontar-refugo-retrabalho', label: 'Apontar Refugo / Retrabalho', target: '/scrap-rework', implemented: true },
      { id: 'lista-de-paradas-ap', label: 'Lista de Paradas', target: '/stoppages', implemented: true },
      { id: 'consulta-item', label: 'Consulta Item', target: '/item-consultation', implemented: true },
      { id: 'plano-controle-cq', label: 'Plano Controle CQ', target: '/quality-control', implemented: true },
    ],
  },
  {
    id: 'administracao',
    label: 'Administração',
    options: [
      { id: 'equipes', label: 'Equipes', target: '/teams', implemented: true },
      { id: 'centro-de-trabalho', label: 'Centro de Trabalho', target: '/work-center', implemented: true },
      { id: 'operador', label: 'Operador', target: '/operators', implemented: true },
      { id: 'reporte-operacoes', label: 'Reporte Operações', target: '/operation-reporting', implemented: true },
      { id: 'reporte-paradas', label: 'Reporte Paradas', target: '/stoppages', implemented: true },
      { id: 'plano-controle-cq-adm', label: 'Plano Controle CQ', target: '/quality-control', implemented: true },
    ],
  },
] satisfies ReadonlyArray<MenuGroup>;

export const SFC_MENU: ReadonlyArray<MenuGroup> = Object.freeze(
  menu.map(group =>
    Object.freeze({
      ...group,
      options: Object.freeze([...group.options]),
    }),
  ),
);
