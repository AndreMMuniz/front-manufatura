import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { EquipesService } from './equipes.service';

describe('EquipesService', () => {
  const team = {
    codigo: 'MONT03', descricao: 'Montagem', turno: 'T1',
    operadores: [{ codigo: '001', nome: 'José' }],
  };

  it('consults, lists and maps data from the API', async () => {
    const get = vi.fn((url: string) => of(url === '/api/operators'
      ? [{ code: '001', name: 'José', role: 'Operador', active: true }]
      : url === '/api/teams' ? [team] : team));
    const service = new EquipesService({ get } as unknown as AuthenticatedApiService);

    await expect(firstValueFrom(service.consultarEquipe(' mont03 '))).resolves.toEqual(team);
    await expect(firstValueFrom(service.listarOperadores())).resolves.toEqual([
      { codigo: '001', nome: 'José' },
    ]);
    await expect(firstValueFrom(service.listarEquipesElegiveis('4001', 'CT-01')))
      .resolves.toEqual([team]);
  });

  it('creates and updates teams through the API with normalized codes', async () => {
    const post = vi.fn().mockReturnValue(of(team));
    const put = vi.fn().mockReturnValue(of(team));
    const service = new EquipesService({ post, put } as unknown as AuthenticatedApiService);

    await firstValueFrom(service.criarEquipe({
      areaCode: '4001', workCenterCode: 'ct-01', operadores: ['001', '001'],
    }));
    await firstValueFrom(service.atualizarEquipe({
      areaCode: '4001', workCenterCode: 'ct-01', codigo: 'mont03', operadores: ['001'],
    }));

    expect(post).toHaveBeenCalledWith('/api/teams', {
      areaCode: '4001', workCenterCode: 'CT-01', operadores: ['001'],
    });
    expect(put).toHaveBeenCalledWith('/api/teams/MONT03', expect.objectContaining({
      workCenterCode: 'CT-01', operadores: ['001'],
    }));
  });

  it('keeps presentation helpers deterministic', () => {
    const service = new EquipesService({} as AuthenticatedApiService);
    const operators = [
      { codigo: '002', nome: 'Álvaro' },
      { codigo: '001', nome: 'José' },
      { codigo: '001', nome: 'José duplicado' },
    ];
    expect(service.removerOperadoresDuplicados(operators).map(item => item.codigo)).toEqual(['001', '002']);
    expect(service.filtrarOperadores(operators, 'alvaro')).toEqual([operators[0]]);
  });
});
