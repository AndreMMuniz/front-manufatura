import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { ReportOperacao } from '../models/report-operacao.model';

import { ReportOperacaoService } from './report-operacao.service';

describe('ReportOperacaoService', () => {
  let service: ReportOperacaoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ReportOperacaoService);
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

  it('requires each partial scrap quantity to match its own reasons', () => {
    const operacao = baseOperacaoIniciada();

    expect(service.validarReporteParcial(operacao, 0, 0, 1.5, [])).toContain('motivos de refugo');
    expect(service.validarReporteParcial(operacao, 0, 0, 1.5, [
      { codigo: '05', descricao: 'Borra', quantidade: 0.5 },
      { codigo: '32', descricao: 'Varredura', quantidade: 1 },
    ])).toBe('');
    expect(service.validarReporteParcial(operacao, 1, 0, 0, [
      { codigo: '05', descricao: 'Borra', quantidade: 0.5 },
    ])).toContain('motivos de refugo');
  });

  it('lists operators and teams as selectable operation responsibles', async () => {
    const responsaveis = await firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01'));

    expect(responsaveis).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }),
      expect.objectContaining({ tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' }),
      expect.objectContaining({ tipo: 'EQUIPE', codigo: 'MONT03' }),
    ]));
    await expect(firstValueFrom(service.listarResponsaveis('4002', 'CT-CQ-01'))).resolves.toEqual([]);
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
