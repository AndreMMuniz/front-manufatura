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

  it('keeps unfinished SFC options marked as not implemented', () => {
    for (const group of SFC_MENU) {
      for (const option of group.options) {
        if (option.label !== 'Plano Controle CQ' && option.label !== 'Centro de Trabalho') {
          expect(option.implemented).toBe(false);
          expect(option.target).toBeUndefined();
        }
      }
    }
  });

  it('Centro de Trabalho is implemented with target /work-center', () => {
    const administracao = SFC_MENU.find(g => g.label === 'Administração');
    const workCenter = administracao?.options.find(o => o.label === 'Centro de Trabalho');

    expect(workCenter).toBeDefined();
    expect(workCenter!.implemented).toBe(true);
    expect(workCenter!.target).toBe('/work-center');
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
