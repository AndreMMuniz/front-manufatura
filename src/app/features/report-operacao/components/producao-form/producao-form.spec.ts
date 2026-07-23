import { ProducaoForm } from './producao-form';

describe('ProducaoForm', () => {
  it('keeps the accumulated operation values as display-only state', () => {
    const component = new ProducaoForm();
    component.operacao = {
      ordem: '450001',
      op: 'OP-1',
      split: '01',
      item: 'ITEM',
      descricao: 'Produto',
      unidade: 'PC',
      roteiro: '10',
      quantidadeOrdem: 10,
      quantidadeSaldo: 10,
      linha: 'Linha',
      dataInicio: new Date(2026, 6, 23),
      horaInicio: '08:00',
      dataFim: new Date(2026, 6, 23),
      horaFim: '08:30',
      quantidadeAprovada: 4,
      quantidadeRetrabalho: 1,
      quantidadeRefugo: 2,
      ct: 'CT-EXT-01',
      grupoMaquina: 'Extrusoras',
      operador: 'Ana',
      equipe: '',
      turno: '1',
    };

    expect(component.operacao.quantidadeAprovada).toBe(4);
    expect(component.operacao.quantidadeRetrabalho).toBe(1);
    expect(component.operacao.quantidadeRefugo).toBe(2);
  });
});
