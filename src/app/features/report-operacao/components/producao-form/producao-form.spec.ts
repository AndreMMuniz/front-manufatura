import { ProducaoForm } from './producao-form';

describe('ProducaoForm', () => {
  it('normalizes the PO datepicker ISO value to a local Date before emitting', () => {
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
      quantidadeAprovada: 0,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      ct: 'CT-EXT-01',
      grupoMaquina: 'Extrusoras',
      operador: 'Ana',
      equipe: 'A',
      turno: '1',
    };
    let emitted: Date | undefined;
    component.producaoChange.subscribe(change => emitted = change.dataFim);

    component.updateEndDate('2026-07-24');

    expect(emitted).toBeInstanceOf(Date);
    expect(emitted?.getFullYear()).toBe(2026);
    expect(emitted?.getMonth()).toBe(6);
    expect(emitted?.getDate()).toBe(24);
  });
});
