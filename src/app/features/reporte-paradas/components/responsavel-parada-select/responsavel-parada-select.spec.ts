import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { ResponsavelParadaSelect } from './responsavel-parada-select';

describe('ResponsavelParadaSelect', () => {
  it('filtra opções por tipo e preserva identidade composta normalizada', async () => {
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

    expect(emitted).toEqual(['OP-01']);
  });

  it('expõe erro de catálogo separado da lista vazia e permite retry', async () => {
    await TestBed.configureTestingModule({
      imports: [ResponsavelParadaSelect],
    }).compileComponents();
    const fixture = TestBed.createComponent(ResponsavelParadaSelect);
    fixture.componentRef.setInput('errorMessage', 'Catálogo indisponível.');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent)
      .toContain('Catálogo indisponível.');

    let retried = false;
    fixture.componentInstance.retry.subscribe(() => retried = true);
    fixture.debugElement.query(By.css('.responsavel-parada__retry'))
      .triggerEventHandler('p-click');

    expect(retried).toBe(true);
  });
});
