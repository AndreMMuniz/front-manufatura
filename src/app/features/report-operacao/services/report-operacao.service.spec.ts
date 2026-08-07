import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSession } from '../../../core/auth/auth.models';
import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import { EquipesService } from '../../equipes/services/equipes.service';
import { ReportOperacao } from '../models/report-operacao.model';

import { ReportOperacaoService } from './report-operacao.service';

describe('ReportOperacaoService', () => {
  let service: ReportOperacaoService;
  let equipesService: EquipesService;

  beforeEach(() => {
    const session$ = new BehaviorSubject<AuthSession | null>({
      user: { id: '1', nome: 'Andre', login: 'andre', permissoes: [] },
      mode: 'ONLINE',
      token: 'token',
      authenticatedAt: new Date(),
      lastValidatedAt: new Date(),
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: { session$ } },
        {
          provide: OperationalCommandFacade,
          useValue: {
            capture: vi.fn(async (request: { idempotencyKey?: string }) => {
              const idempotencyKey =
                request.idempotencyKey ?? '123e4567-e89b-42d3-a456-426614174000';
              return {
                localId: idempotencyKey,
                idempotencyKey,
                payloadHash: 'hash',
                committedAt: '2026-07-30T12:00:00.000Z',
                syncStatus: 'PENDING',
              };
            }),
          },
        },
      ],
    });
    service = TestBed.inject(ReportOperacaoService);
    equipesService = TestBed.inject(EquipesService);
  });

  it('loads a valid operation from the mock Datasul boundary', async () => {
    const orders = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));
    const result = await firstValueFrom(service.carregarOrdemSelecionada(orders[0]));

    expect(result.sucesso).toBe(true);
    expect(result.operacao?.item).toBe('PERFIL-100');
    expect(result.operacao?.quantidadeSaldo).toBe(320);
  });

  it('rejects an unknown operation', async () => {
    const result = await firstValueFrom(
      service.carregarOrdemSelecionada({
        id: 'removed-order',
        ordem: '999999',
        itemOp: 'ITEM-REMOVIDO',
        operacao: '999',
        split: '01',
      }),
    );

    expect(result.sucesso).toBe(false);
    expect(result.mensagem).toContain('OP não encontrada');
  });

  it('lists deterministic production areas with fresh immutable values', async () => {
    const first = await firstValueFrom(service.listarAreasProducao());
    const second = await firstValueFrom(service.listarAreasProducao());

    expect(first).toEqual([
      { code: '4001', description: 'Produção' },
      { code: '4002', description: 'Qualidade' },
    ]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('searches only active work centers belonging to the selected area', async () => {
    await expect(firstValueFrom(service.pesquisarCentrosTrabalho('4001', 'ext'))).resolves.toEqual([
      expect.objectContaining({ code: 'CT-EXT-01', areaCode: '4001', active: true }),
    ]);
    await expect(firstValueFrom(service.pesquisarCentrosTrabalho('4001', 'qualidade'))).resolves.toEqual([]);
    await expect(firstValueFrom(service.pesquisarCentrosTrabalho('area-invalida', ''))).resolves.toEqual([]);
  });

  it('lists only released orders for a coherent area and work center relation', async () => {
    const orders = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));

    expect(orders).toHaveLength(2);
    expect(orders.map(order => order.id)).toEqual(['450001|OP-10458|10|01', '450002|OP-10459|20|01']);
    expect(orders[0]).toEqual({
      id: '450001|OP-10458|10|01',
      ordem: '450001',
      itemOp: 'PERFIL-100 / OP-10458',
      operacao: '10',
      split: '01',
    });
  });

  it('returns an empty list for a valid center without orders and rejects mismatched context', async () => {
    await expect(firstValueFrom(service.listarOrdensPorCentro('4002', 'CT-CQ-01'))).resolves.toEqual([]);
    await expect(firstValueFrom(service.listarOrdensPorCentro('4002', 'CT-EXT-01'))).resolves.toEqual([]);
    await expect(firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-MNT-01'))).resolves.toEqual([]);
  });

  it('does not leak mutations between order-list queries', async () => {
    const first = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));
    const second = await firstValueFrom(service.listarOrdensPorCentro('4001', 'CT-EXT-01'));

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect('$selected' in first[0]).toBe(false);
  });

  it('blocks reporting without operation start', () => {
    expect(service.validarReporte(baseOperacao({ quantidadeAprovada: 1 }))).toBe('Inicie a operação antes de reportar.');
  });

  it('blocks reporting without produced quantity', () => {
    expect(service.validarReporte(baseOperacaoIniciada())).toBe('Informe ao menos uma quantidade produzida.');
  });

  it('blocks negative quantities', () => {
    expect(service.validarReporte(baseOperacaoIniciada({ quantidadeAprovada: -1 }))).toBe('As quantidades não podem ser negativas.');
  });

  it('blocks quantities above available balance', () => {
    expect(service.validarReporte(baseOperacaoIniciada({ quantidadeAprovada: 321 }))).toBe(
      'A quantidade produzida não pode ultrapassar o saldo da OP.',
    );
  });

  it('allows valid reporting payloads', () => {
    expect(service.validarReporte(baseOperacaoIniciada({ quantidadeAprovada: 10 }))).toBe('');
  });

  it('validates partial quantities against the accumulated total and order balance', () => {
    const operacao = baseOperacaoIniciada({
      quantidadeAprovada: 300,
      quantidadeRetrabalho: 10,
    });

    expect(service.validarReporteParcial(operacao, 5, 0, 0)).toBe('');
    expect(service.validarReporteParcial(operacao, 11, 0, 0)).toBe(
      'A quantidade acumulada não pode ultrapassar o saldo da OP.',
    );
    expect(service.validarReporteParcial(operacao, 0, 0, 0)).toBe(
      'Informe ao menos uma quantidade produzida.',
    );
    expect(service.validarReporteParcial(operacao, Number.NaN, 0, 0)).toBe(
      'As quantidades não podem ser negativas.',
    );
  });

  it('accepts decimal quantities that reach the balance after three-decimal rounding', () => {
    const operacao = baseOperacaoIniciada({
      quantidadeSaldo: 0.3,
      quantidadeAprovada: 0.1,
    });

    expect(service.validarReporteParcial(operacao, 0.2, 0, 0)).toBe('');
  });

  it('accepts a partial scrap quantity without requiring reasons', () => {
    const operacao = baseOperacaoIniciada();

    expect(service.validarReporteParcial(operacao, 0, 0, 1.5)).toBe('');
  });

  it('lists operators and teams as selectable operation responsibles', async () => {
    const responsaveis = await firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01'));

    expect(responsaveis).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }),
      expect.objectContaining({ tipo: 'OPERADOR', codigo: '001' }),
      expect.objectContaining({ tipo: 'OPERADOR', codigo: '002' }),
      expect.objectContaining({ tipo: 'OPERADOR', codigo: '003' }),
      expect.objectContaining({ tipo: 'EQUIPE', codigo: 'MONT03' }),
      expect.objectContaining({ tipo: 'EQUIPE', codigo: 'CORTE01' }),
    ]));
    expect(responsaveis).toHaveLength(6);
    await expect(firstValueFrom(service.listarResponsaveis('4002', 'CT-CQ-01'))).resolves.toEqual([
      expect.objectContaining({ tipo: 'EQUIPE', codigo: 'EMB02' }),
    ]);
    await expect(firstValueFrom(service.listarResponsaveis('', 'CT-CQ-01'))).resolves.toEqual([]);
  });

  it('reflete equipes criadas na sessão e preserva colisão de código entre tipos', async () => {
    await firstValueFrom(equipesService.criarEquipe({
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      codigo: ' op-001 ',
      descricao: 'Equipe homônima',
      turno: 'T1',
      operadores: ['001'],
    }));

    const responsaveis = await firstValueFrom(service.listarResponsaveis(' 4001 ', ' ct-ext-01 '));

    expect(responsaveis.filter(item => item.codigo === 'OP-001')).toEqual([
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      { tipo: 'EQUIPE', codigo: 'OP-001', nome: 'Equipe homônima' },
    ]);
  });

  it('não esconde falha do catálogo canônico', async () => {
    vi.spyOn(equipesService, 'listarOperadores')
      .mockReturnValue(throwError(() => new Error('catálogo indisponível')));

    await expect(firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01')))
      .rejects.toThrow('catálogo indisponível');
  });

  it('returns the same ERP report for retries with the same idempotency key', async () => {
    const request = {
      idempotencyKey: 'retry-1',
      ordem: '450001',
      op: 'OP-10458',
      split: '01',
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
      dataInicio: new Date(2026, 6, 30, 8),
      horaInicio: '08:00',
      dataFim: new Date(2026, 6, 30, 9),
      horaFim: '09:00',
      operador: 'Ana Silva',
      equipe: '',
      tipoResponsavel: 'OPERADOR' as const,
      codigoResponsavel: 'OP-001',
      ct: 'CT-EXT-01',
    };

    const first = await firstValueFrom(service.reportarOperacao(request));
    const retry = await firstValueFrom(service.reportarOperacao(request));

    expect(retry.apontamentoId).toBe(first.apontamentoId);
    expect(retry.reportadoEm).toEqual(first.reportadoEm);
  });
});

function baseOperacao(overrides: Partial<ReportOperacao> = {}): ReportOperacao {
  return {
    ordem: '450001',
    op: 'OP-10458',
    split: '01',
    item: 'CORT-1200',
    descricao: 'Riscador profissional para porcelanato',
    unidade: 'PC',
    roteiro: 'MONO-001',
    quantidadeOrdem: 500,
    quantidadeSaldo: 320,
    linha: 'Linha Montagem 02',
    horaInicio: '',
    horaFim: '',
    quantidadeAprovada: 0,
    quantidadeRetrabalho: 0,
    quantidadeRefugo: 0,
    ct: 'CT-ESTAMP-01',
    grupoMaquina: 'Prensas Hidraulicas',
    operador: 'Joao Pereira',
    equipe: 'Equipe A',
    turno: '1o Turno',
    ...overrides,
  };
}

function baseOperacaoIniciada(overrides: Partial<ReportOperacao> = {}): ReportOperacao {
  return baseOperacao({
    dataInicio: new Date(2026, 5, 30),
    horaInicio: '08:00',
    dataFim: new Date(2026, 5, 30),
    horaFim: '08:30',
    ...overrides,
  });
}
