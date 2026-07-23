import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { OrdensSelecionadasBatelada } from './ordens-selecionadas';

describe('OrdensSelecionadasBatelada', () => {
  let fixture: ComponentFixture<OrdensSelecionadasBatelada>;
  let component: OrdensSelecionadasBatelada;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OrdensSelecionadasBatelada] }).compileComponents();
    fixture = TestBed.createComponent(OrdensSelecionadasBatelada);
    component = fixture.componentInstance;
    component.orders = [
      { id: '2', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '20', split: '01' },
      { id: '1', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
    ];
    fixture.detectChanges();
  });

  it('keeps the complete composition visible in selection order', () => {
    const rows = fixture.debugElement.queryAll(By.css('tbody tr'));

    expect(rows).toHaveLength(2);
    expect(rows[0].nativeElement.textContent).toContain('450002');
    expect(rows[1].nativeElement.textContent).toContain('450001');
    expect(fixture.nativeElement.textContent).not.toContain('Quantidade');
  });

  it('announces that the composition is locked after start', () => {
    fixture.componentRef.setInput('locked', true);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[role="status"]')).nativeElement.textContent)
      .toContain('Composição bloqueada');
  });
});
