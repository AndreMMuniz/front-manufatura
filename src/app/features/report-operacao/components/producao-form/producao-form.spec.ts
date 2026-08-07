import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ProducaoForm } from './producao-form';

describe('ProducaoForm', () => {
  let fixture: ComponentFixture<ProducaoForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProducaoForm] }).compileComponents();
    fixture = TestBed.createComponent(ProducaoForm);
    fixture.componentInstance.operacao = operation();
    fixture.detectChanges();
  });

  it('renders all production quantities as disabled accumulated totals', () => {
    const quantities = fixture.debugElement.queryAll(By.css('po-number'));

    expect(quantities).toHaveLength(3);
    expect(quantities.every(field => field.componentInstance.disabled === true)).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Qtde Aprovada');
    expect(fixture.nativeElement.textContent).toContain('Qtde Retrabalho');
    expect(fixture.nativeElement.textContent).toContain('Qtde Refugo');
  });

  it('does not expose editable end date or time controls', () => {
    const dateFields = fixture.debugElement.queryAll(By.css('po-datepicker'));
    const timeFields = fixture.debugElement.queryAll(By.css('po-input'));

    expect(dateFields.every(field => field.componentInstance.disabled === true)).toBe(true);
    expect(timeFields.every(field => field.componentInstance.readonly === true)).toBe(true);
  });
});

function operation() {
  return {
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
}
