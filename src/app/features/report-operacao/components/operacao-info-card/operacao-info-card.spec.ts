import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { OperacaoInfoCard } from './operacao-info-card';

describe('OperacaoInfoCard', () => {
  let fixture: ComponentFixture<OperacaoInfoCard>;
  let component: OperacaoInfoCard;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OperacaoInfoCard] }).compileComponents();
    fixture = TestBed.createComponent(OperacaoInfoCard);
    component = fixture.componentInstance;
    component.responsaveis = [
      { tipo: 'OPERADOR', codigo: '001', nome: 'Jose Ribeiro Neto' },
      { tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Montagem Zap' },
    ];
  });

  it('renderiza a ação de equipe somente quando o tipo selecionado é EQUIPE', () => {
    component.tipoResponsavel = 'OPERADOR';
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.operacao-info__responsavel-group po-button'))).toBeNull();

    fixture.componentRef.setInput('tipoResponsavel', 'EQUIPE');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.operacao-info__responsavel-group po-button'))).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Criar equipe');
  });

  it('desabilita a ação pelo mesmo estado de gestão/loading e mantém opções filtradas', () => {
    component.tipoResponsavel = 'EQUIPE';
    component.gerenciarEquipeDisabled = true;
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('.operacao-info__responsavel-group po-button'));
    expect(button.componentInstance.disabled).toBe(true);
    expect(component.responsavelOptions).toEqual([
      { label: 'MONT03 - Montagem Zap', value: 'MONT03' },
    ]);

    component.gerenciarEquipeDisabled = false;
    component.loadingResponsaveis = true;
    fixture.detectChanges();
    expect(button.componentInstance.disabled).toBe(true);
  });

  it('emite uma vez pelo controle PO-UI real e expõe nome acessível inequívoco', () => {
    component.tipoResponsavel = 'EQUIPE';
    component.gerenciarEquipeDisabled = false;
    component.responsavelDisabled = false;
    const emitted: Array<HTMLElement | null> = [];
    component.gerenciarEquipe.subscribe(acionador => emitted.push(acionador));
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.css('.operacao-info__responsavel-group po-button'));
    const button = host.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Criar ou gerenciar equipe');

    button.focus();
    button.click();

    expect(emitted).toEqual([button]);
  });

  it('bloqueia o tipo sem bloquear a escolha do responsável', () => {
    fixture.componentRef.setInput('tipoResponsavelDisabled', true);
    fixture.componentRef.setInput('responsavelDisabled', false);
    fixture.detectChanges();

    const selects = fixture.debugElement.queryAll(By.css('po-select'));
    expect(selects[0].componentInstance.disabled).toBe(true);
    expect(selects[1].componentInstance.disabled).toBe(false);
  });
});
