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

  it('renders eligible responsible parties and the prefilled operator', () => {
    expect(component.options).toEqual([
      { value: '["OPERADOR","OP-001"]', label: 'Operador — OP-001 - Ana Silva' },
      { value: '["EQUIPE","EQ-A"]', label: 'Equipe — EQ-A - Equipe A' },
    ]);
    expect(component.responsavelKey).toBe('["OPERADOR","OP-001"]');
  });

  it('clearly reports when no responsible party is eligible', () => {
    fixture.componentRef.setInput('responsaveis', []);
    fixture.componentRef.setInput('responsavel', null);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[role="alert"]')).nativeElement.textContent)
      .toContain('Nenhum responsável elegível');
  });

  it('emits explicit selection and becomes read-only after success', () => {
    const selected: unknown[] = [];
    component.responsavelChange.subscribe(value => selected.push(value));
    component.changeResponsavel(component.options[1].value as string);

    expect(selected).toEqual([{ tipo: 'EQUIPE', codigo: 'EQ-A', nome: 'Equipe A' }]);

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('po-select')).componentInstance.disabled).toBe(true);
  });

  it('selects a responsible whose code contains a delimiter without truncating it', () => {
    const selected: unknown[] = [];
    fixture.componentRef.setInput('responsaveis', [
      { tipo: 'OPERADOR', codigo: 'OP|001', nome: 'Ana Silva' },
    ]);
    fixture.componentRef.setInput('responsavel', null);
    fixture.detectChanges();
    component.responsavelChange.subscribe(value => selected.push(value));

    component.changeResponsavel(component.options[0].value as string);

    expect(selected).toEqual([{ tipo: 'OPERADOR', codigo: 'OP|001', nome: 'Ana Silva' }]);
  });
});
