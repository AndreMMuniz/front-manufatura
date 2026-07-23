import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { OrdensCentroBateladaList } from './ordens-centro-list';

describe('OrdensCentroBateladaList', () => {
  let fixture: ComponentFixture<OrdensCentroBateladaList>;
  let component: OrdensCentroBateladaList;
  const orders = [
    { id: 'first', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
    { id: 'second', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '20', split: '01' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OrdensCentroBateladaList] }).compileComponents();
    fixture = TestBed.createComponent(OrdensCentroBateladaList);
    component = fixture.componentInstance;
    component.orders = orders;
    component.showList = true;
    component.ngOnChanges();
    fixture.detectChanges();
  });

  it('supports accessible multiple selection without mutating domain inputs', () => {
    const emissions: string[][] = [];
    component.selectionChange.subscribe(ids => emissions.push([...ids]));

    component.selectRow(component.items[1]);
    component.selectRow(component.items[0]);

    expect(emissions).toEqual([['second'], ['second', 'first']]);
    expect('$selected' in orders[0]).toBe(false);
    expect(component.items.filter(item => item.$selected)).toHaveLength(2);
  });

  it('supports selection through the rendered checkbox DOM and keyboard focus', () => {
    const emissions: string[][] = [];
    component.selectionChange.subscribe(ids => emissions.push([...ids]));
    const checkboxes = fixture.debugElement.queryAll(By.css('[role="checkbox"]'));

    expect(checkboxes).toHaveLength(1);
    const first = checkboxes[0].nativeElement as HTMLElement;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    first.click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(first);
    expect(emissions.at(-1)).toEqual(['first', 'second']);
  });

  it('announces the selected count and prepares only with a selection', () => {
    expect(component.prepareDisabled).toBe(true);
    expect(fixture.debugElement.query(By.css('[aria-live="polite"]'))).toBeTruthy();

    component.selectRow(component.items[0]);
    fixture.detectChanges();

    expect(component.prepareDisabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('1 ordem(ns) selecionada(s)');
  });

  it('gives the rendered table an accessible name', () => {
    const table = fixture.nativeElement.querySelector('table');

    expect(table).toBeTruthy();
    expect(table.getAttribute('aria-label')).toBe('Ordens liberadas para seleção');
  });

  it('renders loading and empty states without horizontal page overflow', () => {
    component.loading = true;
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[role="status"]'))).toBeTruthy();

    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('orders', []);
    component.ngOnChanges();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nenhuma ordem liberada');
  });

  it('blocks selection and preparation after the composition is locked', () => {
    component.disabled = true;
    component.selectRow(component.items[0]);

    expect(component.selectedIds.size).toBe(0);
    expect(component.prepareDisabled).toBe(true);
  });
});
