import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ReportOperacao } from '../models/report-operacao.model';

import { ReportOperacaoService } from './report-operacao.service';

describe('ReportOperacaoService', () => {
  const service = new ReportOperacaoService();

  it('loads a valid operation from the mock Datasul boundary', async () => {
    const result = await firstValueFrom(service.consultarOP({ ordem: '450001', op: 'OP-10458', split: '01' }));

    expect(result.sucesso).toBe(true);
    expect(result.operacao?.item).toBe('CORT-1200');
    expect(result.operacao?.quantidadeSaldo).toBe(320);
  });

  it('rejects an unknown operation', async () => {
    const result = await firstValueFrom(service.consultarOP({ ordem: '999999', op: 'OP-00000', split: '' }));

    expect(result.sucesso).toBe(false);
    expect(result.mensagem).toContain('OP não encontrada');
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
