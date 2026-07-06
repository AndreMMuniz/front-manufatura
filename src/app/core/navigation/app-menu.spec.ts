import { describe, expect, it } from 'vitest';

import { SFC_MENU } from './app-menu';

describe('SFC_MENU', () => {
  it('has exactly three groups', () => {
    expect(SFC_MENU).toHaveLength(3);
  });

  it('groups are named Produção, Apontamento and Administração', () => {
    expect(SFC_MENU.map(g => g.label)).toEqual(['Produção', 'Apontamento', 'Administração']);
  });

  it('Plano Controle CQ is present in Apontamento and Administracao and is implemented with target /quality-control', () => {
    const apontamento = SFC_MENU.find(g => g.label === 'Apontamento');
    const administracao = SFC_MENU.find(g => g.label === 'Administração');

    expect(apontamento).toBeDefined();
    expect(administracao).toBeDefined();

    const cqAp = apontamento!.options.find(o => o.label === 'Plano Controle CQ');
    const cqAd = administracao!.options.find(o => o.label === 'Plano Controle CQ');

    expect(cqAp).toBeDefined();
    expect(cqAp!.implemented).toBe(true);
    expect(cqAp!.target).toBe('/quality-control');

    expect(cqAd).toBeDefined();
    expect(cqAd!.implemented).toBe(true);
    expect(cqAd!.target).toBe('/quality-control');
  });

  it('maps pending SFC modules to explicit placeholder routes', () => {
    const expectedTargets = new Map([
      ['iniciar-ordem', '/operation-reporting'],
      ['iniciar-ordem-batelada', '/batch-reporting'],
      ['reporte-ordem', '/operation-reporting'],
      ['reporte-batelada', '/batch-reporting'],
      ['inicio-de-parada', '/stoppages'],
      ['encerrar-parada', '/stoppages'],
      ['parada-programada', '/stoppages'],
      ['apontar-refugo', '/scrap-rework'],
      ['lista-de-paradas', '/stoppages'],
      ['iniciar-ordens', '/operation-reporting'],
      ['reporte', '/operation-reporting'],
      ['inicio-de-parada-ap', '/stoppages'],
      ['encerrar-parada-ap', '/stoppages'],
      ['apontar-refugo-retrabalho', '/scrap-rework'],
      ['lista-de-paradas-ap', '/stoppages'],
      ['consulta-item', '/item-consultation'],
      ['equipes', '/teams'],
      ['reporte-operacoes', '/operation-reporting'],
      ['reporte-paradas', '/stoppages'],
    ]);

    const options = SFC_MENU.flatMap(group => group.options);

    for (const [id, target] of expectedTargets) {
      const option = options.find(item => item.id === id);

      expect(option).toBeDefined();
      expect(option!.implemented).toBe(true);
      expect(option!.target).toBe(target);
    }
  });

  it('keeps every SFC menu option implemented through real or placeholder targets', () => {
    for (const option of SFC_MENU.flatMap(group => group.options)) {
      expect(option.implemented).toBe(true);
      expect(option.target).toBeTruthy();
    }
  });

  it('Centro de Trabalho is implemented with target /work-center', () => {
    const administracao = SFC_MENU.find(g => g.label === 'Administração');
    const workCenter = administracao?.options.find(o => o.label === 'Centro de Trabalho');

    expect(workCenter).toBeDefined();
    expect(workCenter!.implemented).toBe(true);
    expect(workCenter!.target).toBe('/work-center');
  });

  it('Reporte Batelada is implemented with target /batch-reporting', () => {
    const producao = SFC_MENU.find(g => g.label === 'Produção');
    const batchReport = producao?.options.find(o => o.label === 'Reporte Batelada');

    expect(batchReport).toBeDefined();
    expect(batchReport!.implemented).toBe(true);
    expect(batchReport!.target).toBe('/batch-reporting');
  });

  it('Operador is implemented with target /operators and sits in Administracao', () => {
    const administracao = SFC_MENU.find(g => g.label === 'Administração');
    const operador = administracao?.options.find(o => o.label === 'Operador');

    expect(operador).toBeDefined();
    expect(operador!.implemented).toBe(true);
    expect(operador!.target).toBe('/operators');
  });

  it('every option has a unique id within its group and every group has an id', () => {
    for (const group of SFC_MENU) {
      expect(group.id).toBeTruthy();
      const ids = group.options.map(o => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const option of group.options) {
        expect(option.id).toBeTruthy();
      }
    }
  });

  it('is frozen at the top level and for nested option collections', () => {
    expect(Object.isFrozen(SFC_MENU)).toBe(true);
    for (const group of SFC_MENU) {
      expect(Object.isFrozen(group)).toBe(true);
      expect(Object.isFrozen(group.options)).toBe(true);
    }
  });
});
