import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { AuthSession } from '../../../core/auth/auth.models';
import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { EquipesService } from './equipes.service';

describe('EquipesService', () => {
  let service: EquipesService;
  let session$: BehaviorSubject<AuthSession | null>;

  beforeEach(() => {
    session$ = new BehaviorSubject<AuthSession | null>({
      user: { id: '1', nome: 'Andre', login: 'andre', permissoes: [] },
      token: 'token',
      authenticatedAt: new Date(),
    });
    TestBed.configureTestingModule({
      providers: [EquipesService, { provide: AuthSessionService, useValue: { session$ } }],
    });
    service = TestBed.inject(EquipesService);
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

    expect(operadores).toHaveLength(11);
    expect(operadores).toEqual(
      expect.arrayContaining([
        { codigo: 'OP-001', nome: 'Ana Silva' },
        { codigo: '001', nome: 'Jose Ribeiro Neto' },
      ]),
    );
  });

  it('filtra operadores por código, nome e acentuação', async () => {
    const operadores = await firstValueFrom(service.listarOperadores());

    expect(service.filtrarOperadores(operadores, '004')).toEqual([
      { codigo: '004', nome: 'Marcelo Costa' },
    ]);
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

  it('lista somente equipes elegíveis para o contexto normalizado e devolve cópias', async () => {
    const equipes = await firstValueFrom(service.listarEquipesElegiveis(' 4001 ', 'ct-ext-01'));

    expect(equipes.map((equipe) => equipe.codigo)).toEqual(['CORTE01', 'MONT03']);
    expect(await firstValueFrom(service.listarEquipesElegiveis('4002', 'CT-CQ-01'))).toEqual([
      expect.objectContaining({ codigo: 'EMB02' }),
    ]);
    expect(await firstValueFrom(service.listarEquipesElegiveis('', 'CT-EXT-01'))).toEqual([]);

    (equipes[0].operadores as Array<{ codigo: string; nome: string }>).push({
      codigo: '999',
      nome: 'Mutação externa',
    });
    const novaConsulta = await firstValueFrom(service.listarEquipesElegiveis('4001', 'CT-EXT-01'));
    expect(novaConsulta[0].operadores).not.toContainEqual(
      expect.objectContaining({ codigo: '999' }),
    );
  });

  it('cria uma equipe vinculada a um único contexto e retorna a forma canônica', async () => {
    const criada = await firstValueFrom(
      service.criarEquipe({
        areaCode: ' 5000 ',
        workCenterCode: ' ct-novo ',
        codigo: ' eq01 ',
        descricao: ' Equipe Nova ',
        turno: ' Turno 1 ',
        operadores: ['002', '001'],
      }),
    );

    expect(criada).toEqual({
      codigo: 'EQ01',
      descricao: 'Equipe Nova',
      turno: 'Turno 1',
      operadores: [
        { codigo: '001', nome: 'Jose Ribeiro Neto' },
        { codigo: '002', nome: 'Almir Rogerio Bento' },
      ],
    });
    expect(await firstValueFrom(service.listarEquipesElegiveis('5000', 'CT-NOVO'))).toEqual([
      criada,
    ]);
    expect(
      await firstValueFrom(service.listarEquipesElegiveis('4001', 'CT-EXT-01')),
    ).not.toContainEqual(expect.objectContaining({ codigo: 'EQ01' }));
  });

  it.each([
    {
      nome: 'contexto vazio',
      request: {
        areaCode: ' ',
        workCenterCode: 'CT',
        codigo: 'EQ01',
        descricao: 'Equipe',
        turno: 'T1',
        operadores: ['001'],
      },
      mensagem: 'Informe a Área de Produção e o Centro de Trabalho.',
    },
    {
      nome: 'campo obrigatório',
      request: {
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: ' ',
        descricao: 'Equipe',
        turno: 'T1',
        operadores: ['001'],
      },
      mensagem: 'Informe código, descrição e turno da equipe.',
    },
    {
      nome: 'nenhum operador',
      request: {
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: 'EQ01',
        descricao: 'Equipe',
        turno: 'T1',
        operadores: [],
      },
      mensagem: 'Selecione ao menos um operador.',
    },
    {
      nome: 'operador inexistente',
      request: {
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: 'EQ01',
        descricao: 'Equipe',
        turno: 'T1',
        operadores: ['999'],
      },
      mensagem: 'O operador 999 não existe.',
    },
    {
      nome: 'operador duplicado normalizado',
      request: {
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: 'EQ01',
        descricao: 'Equipe',
        turno: 'T1',
        operadores: ['001', ' 001 '],
      },
      mensagem: 'A lista de operadores contém códigos duplicados.',
    },
  ])('rejeita criação com $nome sem mutar o catálogo', async ({ request, mensagem }) => {
    const antes = await firstValueFrom(service.listarEquipesElegiveis('4001', 'CT-EXT-01'));

    await expect(firstValueFrom(service.criarEquipe(request))).rejects.toThrow(mensagem);

    expect(await firstValueFrom(service.listarEquipesElegiveis('4001', 'CT-EXT-01'))).toEqual(
      antes,
    );
  });

  it('rejeita código global duplicado após normalização', async () => {
    await expect(
      firstValueFrom(
        service.criarEquipe({
          areaCode: '5000',
          workCenterCode: 'CT-NOVO',
          codigo: ' mont03 ',
          descricao: 'Outra',
          turno: 'T1',
          operadores: ['001'],
        }),
      ),
    ).rejects.toThrow('Já existe uma equipe com esse código.');
  });

  it('atualiza atomicamente somente operadores e valida elegibilidade', async () => {
    const atualizada = await firstValueFrom(
      service.atualizarEquipe({
        areaCode: ' 4001 ',
        workCenterCode: 'ct-ext-01',
        codigo: ' mont03 ',
        operadores: ['005', '003'],
      }),
    );

    expect(atualizada).toEqual({
      codigo: 'MONT03',
      descricao: 'Montagem Zap',
      turno: 'Turno 3',
      operadores: [
        { codigo: '003', nome: 'Carlos Silva' },
        { codigo: '005', nome: 'Fernanda Alves' },
      ],
    });

    await expect(
      firstValueFrom(
        service.atualizarEquipe({
          areaCode: '4002',
          workCenterCode: 'CT-CQ-01',
          codigo: 'MONT03',
          operadores: ['001'],
        }),
      ),
    ).rejects.toThrow('A equipe não é elegível para a Área e o Centro de Trabalho informados.');

    expect(await firstValueFrom(service.consultarEquipe('MONT03'))).toEqual(atualizada);
  });

  it('rejeita operadores duplicados ou inexistentes na atualização sem gravar parcialmente', async () => {
    const original = await firstValueFrom(service.consultarEquipe('MONT03'));

    await expect(
      firstValueFrom(
        service.atualizarEquipe({
          areaCode: '4001',
          workCenterCode: 'CT-EXT-01',
          codigo: 'MONT03',
          operadores: ['001', '001'],
        }),
      ),
    ).rejects.toThrow('A lista de operadores contém códigos duplicados.');
    await expect(
      firstValueFrom(
        service.atualizarEquipe({
          areaCode: '4001',
          workCenterCode: 'CT-EXT-01',
          codigo: 'MONT03',
          operadores: ['999'],
        }),
      ),
    ).rejects.toThrow('O operador 999 não existe.');

    expect(await firstValueFrom(service.consultarEquipe('MONT03'))).toEqual(original);
  });

  it('restaura a seed ao encerrar a sessão', async () => {
    await firstValueFrom(
      service.criarEquipe({
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: 'TEMP',
        descricao: 'Temporária',
        turno: 'T1',
        operadores: ['001'],
      }),
    );
    await firstValueFrom(
      service.atualizarEquipe({
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: 'MONT03',
        operadores: ['010'],
      }),
    );

    session$.next(null);
    session$.next(authSession('2'));

    await expect(firstValueFrom(service.consultarEquipe('TEMP'))).rejects.toThrow(
      'Não foi possível localizar a equipe.',
    );
    expect(
      (await firstValueFrom(service.consultarEquipe('MONT03'))).operadores.map(
        (item) => item.codigo,
      ),
    ).toEqual(['001', '002', '004']);
  });

  it('invalida leituras e gravações pendentes quando a sessão termina', async () => {
    const consultaPendente = firstValueFrom(service.consultarEquipe('MONT03'));
    const criacaoPendente = firstValueFrom(
      service.criarEquipe({
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: 'TEMP',
        descricao: 'Temporária',
        turno: 'T1',
        operadores: ['001'],
      }),
    );

    session$.next(null);

    await expect(consultaPendente).rejects.toThrow(
      'A sessão autenticada não está mais disponível.',
    );
    await expect(criacaoPendente).rejects.toThrow('A sessão autenticada não está mais disponível.');

    session$.next(authSession('2'));
    await expect(firstValueFrom(service.consultarEquipe('TEMP'))).rejects.toThrow(
      'Não foi possível localizar a equipe.',
    );
  });

  it('restaura a seed ao trocar diretamente de sessão autenticada', async () => {
    await firstValueFrom(
      service.criarEquipe({
        areaCode: '4001',
        workCenterCode: 'CT-EXT-01',
        codigo: 'TEMP',
        descricao: 'Temporária',
        turno: 'T1',
        operadores: ['001'],
      }),
    );

    session$.next(authSession('2'));

    await expect(firstValueFrom(service.consultarEquipe('TEMP'))).rejects.toThrow(
      'Não foi possível localizar a equipe.',
    );
  });

  it('rejeita operações de catálogo sem sessão autenticada', async () => {
    session$.next(null);

    await expect(firstValueFrom(service.listarOperadores())).rejects.toThrow(
      'A sessão autenticada não está mais disponível.',
    );
    await expect(
      firstValueFrom(
        service.criarEquipe({
          areaCode: '4001',
          workCenterCode: 'CT-EXT-01',
          codigo: 'TEMP',
          descricao: 'Temporária',
          turno: 'T1',
          operadores: ['001'],
        }),
      ),
    ).rejects.toThrow('A sessão autenticada não está mais disponível.');
  });
});

function authSession(userId: string): AuthSession {
  return {
    user: { id: userId, nome: `Usuário ${userId}`, login: `usuario${userId}`, permissoes: [] },
    token: `token-${userId}`,
    authenticatedAt: new Date(),
  };
}
