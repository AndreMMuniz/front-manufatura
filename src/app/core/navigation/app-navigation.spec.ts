import { APP_MODULE_NAVIGATION } from './app-navigation';

describe('APP_MODULE_NAVIGATION', () => {
  const expected = [
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
  ];

  it('defines only the approved modules in display order', () => {
    expect(APP_MODULE_NAVIGATION).toEqual(expected);
  });

  it('keeps ids and routes unique', () => {
    const ids = APP_MODULE_NAVIGATION.map(item => item.id);
    const routes = APP_MODULE_NAVIGATION.map(item => item.route);

    expect(new Set(ids).size).toBe(APP_MODULE_NAVIGATION.length);
    expect(new Set(routes).size).toBe(APP_MODULE_NAVIGATION.length);
  });

  it('excludes structural, session, and removed module entries', () => {
    const labels = APP_MODULE_NAVIGATION.map(item => item.label);

    expect(labels).not.toContain('Menu Principal');
    expect(labels).not.toContain('Sair');
    expect(labels).not.toContain('Consulta Item');
    expect(labels).not.toContain('Refugo / Retrabalho');
    expect(labels).not.toContain('Centro de Trabalho');
    expect(labels).not.toContain('Operador');
    expect(labels).not.toContain('Equipes');
  });

  it('is immutable at runtime down to every item', () => {
    expect(Object.isFrozen(APP_MODULE_NAVIGATION)).toBe(true);
    for (const item of APP_MODULE_NAVIGATION) {
      expect(Object.isFrozen(item)).toBe(true);
    }
  });
});
