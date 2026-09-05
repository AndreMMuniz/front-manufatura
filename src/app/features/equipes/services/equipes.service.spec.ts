import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, of, throwError } from 'rxjs';
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

  it('creates and updates teams through distinct API contracts', async () => {
    const post = vi.fn().mockReturnValue(of(team));
    const put = vi.fn().mockReturnValue(of(team));
    const service = new EquipesService({ post, put } as unknown as AuthenticatedApiService);

    await firstValueFrom(service.criarEquipe({
      areaCode: '4001', workCenterCode: 'ct-01', operadores: ['001', '001'],
    }));
    await expect(firstValueFrom(service.atualizarEquipe({
      codigo: 'mont03', operadores: ['001'],
    }))).resolves.toEqual({ equipe: team, sincronizacaoPendente: false });

    expect(post).toHaveBeenCalledWith('/api/teams', {
      areaCode: '4001', workCenterCode: 'CT-01', operadores: ['001'],
    });
    expect(put).toHaveBeenCalledWith('/api/teams/MONT03', { operadores: ['001'] });
  });

  it('shows a Datasul rejection without enqueueing the team update', async () => {
    const capture = vi.fn();
    const put = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 422,
      error: {
        code: 'DATASUL_COMMAND_REJECTED',
        category: 'VALIDATION',
        userMessage: 'O operador informado não pode integrar esta equipe.',
      },
    })));
    const service = new EquipesService(
      { put } as unknown as AuthenticatedApiService,
      { capture } as never,
    );

    await expect(firstValueFrom(service.atualizarEquipe({
      codigo: 'AUT00039', operadores: ['00016570'],
    }))).rejects.toThrow('O operador informado não pode integrar esta equipe.');
    expect(capture).not.toHaveBeenCalled();
  });

  it('enqueues the team update only after a communication failure', async () => {
    const capture = vi.fn().mockResolvedValue({ localId: 'local-team-1' });
    const put = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    const service = new EquipesService(
      { put } as unknown as AuthenticatedApiService,
      { capture } as never,
    );

    await expect(firstValueFrom(service.atualizarEquipe({
      codigo: ' aut00039 ', operadores: ['00016570', '00016570', '00016580'],
    }))).resolves.toEqual({ sincronizacaoPendente: true });
    expect(capture).toHaveBeenCalledWith({
      commandType: 'UPDATE_TEAM',
      aggregateId: 'AUT00039',
      businessStatus: 'ALTERACAO_PENDENTE',
      payload: {
        codigo: 'AUT00039',
        operadores: ['00016570', '00016580'],
      },
    });
  });

  it('preserva os alertas devolvidos ao criar a equipe', async () => {
    const alert = 'Quantidade de operadores informada (6) diferente da parametrizada (4)';
    const post = vi.fn().mockReturnValue(of({
      ...team,
      alertas: [{ mensagem: alert }],
    }));
    const service = new EquipesService({ post } as unknown as AuthenticatedApiService);

    const result = await firstValueFrom(service.criarEquipe({
      areaCode: '4001', workCenterCode: 'CT-01', operadores: ['001'],
    }));

    expect(result).toEqual({ ...team, alertas: [{ mensagem: alert }] });
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
