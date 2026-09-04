import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { InformacoesBatelada } from './informacoes-batelada';

describe('InformacoesBatelada', () => {
  let fixture: ComponentFixture<InformacoesBatelada>;
  let component: InformacoesBatelada;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InformacoesBatelada] }).compileComponents();
    fixture = TestBed.createComponent(InformacoesBatelada);
    component = fixture.componentInstance;
    component.responsaveis = [
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      { tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' },
    ];
    component.responsavel = component.responsaveis[0];
    fixture.detectChanges();
  });

  it('renderiza o operador em input livre sem placeholder', () => {
    expect(component.operadorCodigo).toBe('OP-001');
    const input = fixture.debugElement.query(By.css('po-input[name="operadorBatelada"]'));
    expect(input).toBeTruthy();
    expect(input.nativeElement.getAttribute('p-placeholder')).toBeNull();
  });

  it('não depende do catálogo no modo operador', () => {
    fixture.componentRef.setInput('responsaveis', []);
    fixture.componentRef.setInput('responsavel', null);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.informacoes-batelada__error'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.informacoes-batelada__responsavel po-button')))
      .toBeNull();
  });

  it('emite equipe catalogada e fica somente leitura após o início', () => {
    component.tipoResponsavel = 'EQUIPE';
    const selected: unknown[] = [];
    component.responsavelChange.subscribe(value => selected.push(value));
    component.changeResponsavel(component.equipeOptions[0].value as string);

    expect(selected).toEqual([{ tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' }]);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const selects = fixture.debugElement.queryAll(By.css('po-select'));
    expect(selects.every(select => select.componentInstance.disabled)).toBe(true);
  });

  it('preserva caixa, formato e delimitadores no código livre', () => {
    const selected: unknown[] = [];
    component.responsavelChange.subscribe(value => selected.push(value));

    component.changeOperador(' op.int|7-a ');

    expect(selected).toEqual([{
      tipo: 'OPERADOR', codigo: ' op.int|7-a ', nome: ' op.int|7-a ',
    }]);
  });

  it('exibe a ação de equipe somente quando o responsável não é um operador', () => {
    expect(fixture.debugElement.query(
      By.css('.informacoes-batelada__responsavel po-button'),
    )).toBeNull();

    fixture.componentRef.setInput('tipoResponsavel', 'EQUIPE');
    fixture.detectChanges();

    expect(fixture.debugElement.query(
      By.css('.informacoes-batelada__responsavel po-button'),
    )).toBeTruthy();
  });

  it('não emite a gestão de equipe quando o responsável é um operador', () => {
    const emitted: Array<HTMLElement | null> = [];
    component.gerenciarEquipe.subscribe(acionador => emitted.push(acionador));

    component.onGerenciarEquipe();

    expect(emitted).toEqual([]);
  });

  it('emite a gestão pelo botão PO-UI real e bloqueia a ação após o início', () => {
    fixture.componentRef.setInput('tipoResponsavel', 'EQUIPE');
    fixture.detectChanges();
    const emitted: Array<HTMLElement | null> = [];
    component.gerenciarEquipe.subscribe(acionador => emitted.push(acionador));
    const host = fixture.debugElement.query(
      By.css('.informacoes-batelada__responsavel po-button'),
    );
    const button = host.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('aria-label')).toBe('Criar ou gerenciar equipe');
    button.focus();
    button.click();
    expect(emitted).toEqual([button]);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(host.componentInstance.disabled).toBe(true);
    button.click();
    component.onGerenciarEquipe();
    expect(emitted).toEqual([button]);
  });
});
