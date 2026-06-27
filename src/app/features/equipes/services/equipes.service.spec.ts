import { firstValueFrom } from 'rxjs';

import { EquipesService } from './equipes.service';

describe('EquipesService', () => {
  let service: EquipesService;

  beforeEach(() => {
    service = new EquipesService();
  });

  it('consulta uma equipe existente normalizando o código', async () => {
    const equipe = await firstValueFrom(service.consultarEquipe(' mont03 '));

    expect(equipe).toEqual({
      codigo: 'MONT03',
      descricao: 'Montagem Zap',
      turno: 'Turno 3',
      operadores: [
        { codigo: '001', nome: 'Jose Ribeiro Neto' },
        { codigo: '002', nome: 'Almir Rogerio Bento' },
        { codigo: '004', nome: 'Marcelo Costa' },
      ],
    });
  });

  it('retorna erro amigável para equipe inexistente', async () => {
    await expect(firstValueFrom(service.consultarEquipe('NAO_EXISTE'))).rejects.toThrow(
      'Não foi possível localizar a equipe.',
    );
  });

  it('lista todos os operadores disponíveis para o painel', async () => {
    const operadores = await firstValueFrom(service.listarOperadores());

    expect(operadores).toHaveLength(10);
    expect(operadores[0]).toEqual({ codigo: '001', nome: 'Jose Ribeiro Neto' });
  });

  it('filtra operadores por código, nome e acentuação', async () => {
    const operadores = await firstValueFrom(service.listarOperadores());

    expect(service.filtrarOperadores(operadores, '004')).toEqual([{ codigo: '004', nome: 'Marcelo Costa' }]);
    expect(service.filtrarOperadores(operadores, 'rogério')).toEqual([
      { codigo: '002', nome: 'Almir Rogerio Bento' },
    ]);
  });

  it('salva operadores sem duplicidade e atualiza a equipe consultada', async () => {
    await firstValueFrom(
      service.salvarEquipe({
        codigoEquipe: 'MONT03',
        operadores: ['003', '003', '005'],
      }),
    );

    const equipe = await firstValueFrom(service.consultarEquipe('MONT03'));

    expect(equipe.operadores).toEqual([
      { codigo: '003', nome: 'Carlos Silva' },
      { codigo: '005', nome: 'Fernanda Alves' },
    ]);
  });

  it('monta equipe atualizada mantendo ordenação e removendo duplicidade', () => {
    const equipe = {
      codigo: 'MONT03',
      descricao: 'Montagem Zap',
      turno: 'Turno 3',
      operadores: [],
    };

    expect(
      service.montarEquipeAtualizada(equipe, [
        { codigo: '010', nome: 'Rafael Gomes' },
        { codigo: '001', nome: 'Jose Ribeiro Neto' },
        { codigo: '001', nome: 'Jose Ribeiro Neto' },
      ]).operadores,
    ).toEqual([
      { codigo: '001', nome: 'Jose Ribeiro Neto' },
      { codigo: '010', nome: 'Rafael Gomes' },
    ]);
  });
});
