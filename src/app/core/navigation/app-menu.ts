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
      { id: 'iniciar-ordem', label: 'Iniciar Ordem', implemented: false },
      { id: 'iniciar-ordem-batelada', label: 'Iniciar Ordem Batelada', implemented: false },
      { id: 'reporte-ordem', label: 'Reporte Ordem', implemented: false },
      { id: 'reporte-batelada', label: 'Reporte Batelada', implemented: false },
      { id: 'inicio-de-parada', label: 'Início de Parada', implemented: false },
      { id: 'encerrar-parada', label: 'Encerrar Parada', implemented: false },
      { id: 'parada-programada', label: 'Parada Programada', implemented: false },
      { id: 'apontar-refugo', label: 'Apontar Refugo', implemented: false },
      { id: 'lista-de-paradas', label: 'Lista de Paradas', implemented: false },
    ],
  },
  {
    id: 'apontamento',
    label: 'Apontamento',
    options: [
      { id: 'iniciar-ordens', label: 'Iniciar Ordens', implemented: false },
      { id: 'reporte', label: 'Reporte', implemented: false },
      { id: 'inicio-de-parada-ap', label: 'Início de Parada', implemented: false },
      { id: 'encerrar-parada-ap', label: 'Encerrar Parada', implemented: false },
      { id: 'apontar-refugo-retrabalho', label: 'Apontar Refugo / Retrabalho', implemented: false },
      { id: 'lista-de-paradas-ap', label: 'Lista de Paradas', implemented: false },
      { id: 'consulta-item', label: 'Consulta Item', implemented: false },
      { id: 'plano-controle-cq', label: 'Plano Controle CQ', target: '/quality-control', implemented: true },
    ],
  },
  {
    id: 'administracao',
    label: 'Administração',
    options: [
      { id: 'equipes', label: 'Equipes', implemented: false },
      { id: 'centro-de-trabalho', label: 'Centro de Trabalho', target: '/work-center', implemented: true },
      { id: 'reporte-operacoes', label: 'Reporte Operações', implemented: false },
      { id: 'reporte-paradas', label: 'Reporte Paradas', implemented: false },
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
