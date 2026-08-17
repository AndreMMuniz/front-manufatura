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

  it('allows editing only the start date and time before the operation starts', () => {
    const dateFields = fixture.debugElement.queryAll(By.css('po-datepicker'));
    const timeFields = fixture.debugElement.queryAll(By.css('po-input'));

    expect(dateFields[0].componentInstance.disabled).toBe(false);
    expect(timeFields[0].componentInstance.readonly).toBe(false);
    expect(dateFields[1].componentInstance.disabled).toBe(true);
    expect(timeFields[1].componentInstance.readonly).toBe(true);
  });

  it('locks the start date and time while starting or after the operation starts', () => {
    fixture.componentInstance.inicioDisabled = true;
    fixture.detectChanges();

    const dateFields = fixture.debugElement.queryAll(By.css('po-datepicker'));
    const timeFields = fixture.debugElement.queryAll(By.css('po-input'));

    expect(dateFields[0].componentInstance.disabled).toBe(true);
    expect(timeFields[0].componentInstance.readonly).toBe(true);
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
