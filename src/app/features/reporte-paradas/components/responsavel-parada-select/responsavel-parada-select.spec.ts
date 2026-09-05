import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { ResponsavelParadaSelect } from './responsavel-parada-select';

describe('ResponsavelParadaSelect', () => {
  it('renderiza operador como input livre e preserva exatamente o código informado', async () => {
    await TestBed.configureTestingModule({
      imports: [ResponsavelParadaSelect],
    }).compileComponents();
    const fixture = TestBed.createComponent(ResponsavelParadaSelect);
    fixture.componentRef.setInput('responsibleType', 'OPERADOR');
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('po-input[name="responsavelParada"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('po-select[name="responsavelParada"]'))).toBeNull();

    const emitted: string[] = [];
    fixture.componentInstance.responsibleCodeChange.subscribe(value => emitted.push(value));
    fixture.componentInstance.changeResponsible(' op.int/7-a ');

    expect(emitted).toEqual([' op.int/7-a ']);
  });

  it('mantém equipes elegíveis em dropdown e normaliza o código selecionado', async () => {
    await TestBed.configureTestingModule({
      imports: [ResponsavelParadaSelect],
    }).compileComponents();
    const fixture = TestBed.createComponent(ResponsavelParadaSelect);
    fixture.componentRef.setInput('responsibleType', 'EQUIPE');
    fixture.componentRef.setInput('responsibles', [
      { tipo: 'EQUIPE', codigo: ' eq-01 ', nome: 'Equipe Um' },
    ]);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('po-select[name="responsavelParada"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('po-input[name="responsavelParada"]'))).toBeNull();

    const emitted: string[] = [];
    fixture.componentInstance.responsibleCodeChange.subscribe(value => emitted.push(value));
    fixture.componentInstance.changeResponsible(' eq-01 ');

    expect(emitted).toEqual(['EQ-01']);
  });

  it('filtra opções por tipo sem transformar o valor livre do operador', async () => {
    await TestBed.configureTestingModule({
      imports: [ResponsavelParadaSelect],
    }).compileComponents();
    const fixture: ComponentFixture<ResponsavelParadaSelect> =
      TestBed.createComponent(ResponsavelParadaSelect);
    fixture.componentRef.setInput('responsibles', [
      { tipo: 'OPERADOR', codigo: ' op-01 ', nome: 'Ana' },
      { tipo: 'EQUIPE', codigo: 'OP-01', nome: 'Equipe OP' },
    ]);
    fixture.componentRef.setInput('responsibleType', 'OPERADOR');
    fixture.detectChanges();

    expect(fixture.componentInstance.responsibleOptions).toEqual([
      { value: 'OP-01', label: 'OP-01 - Ana' },
    ]);

    const emitted: string[] = [];
    fixture.componentInstance.responsibleCodeChange.subscribe(value => emitted.push(value));
    fixture.componentInstance.changeResponsible(' op-01 ');

    expect(emitted).toEqual([' op-01 ']);
  });

  it('expõe erro de catálogo separado da lista vazia e permite retry', async () => {
    await TestBed.configureTestingModule({
      imports: [ResponsavelParadaSelect],
    }).compileComponents();
    const fixture = TestBed.createComponent(ResponsavelParadaSelect);
    fixture.componentRef.setInput('errorMessage', 'Catálogo indisponível.');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.responsavel-parada__error[role="alert"]')?.textContent)
      .toContain('Catálogo indisponível.');

    let retried = false;
    fixture.componentInstance.retry.subscribe(() => retried = true);
    fixture.debugElement.query(By.css('.responsavel-parada__retry'))
      .triggerEventHandler('p-click');

    expect(retried).toBe(true);
  });
});
