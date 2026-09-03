import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { OrdemCentroTrabalho } from '../../models/report-operacao.model';
import { OrdensCentroList } from './ordens-centro-list';

describe('OrdensCentroList', () => {
  let fixture: ComponentFixture<OrdensCentroList>;
  let component: OrdensCentroList;

  const orders: OrdemCentroTrabalho[] = [
    { id: 'first', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
    { id: 'second', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '20', split: '01' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OrdensCentroList] }).compileComponents();
    fixture = TestBed.createComponent(OrdensCentroList);
    component = fixture.componentInstance;
    component.orders = orders;
    component.showList = true;
    component.ngOnChanges();
    fixture.detectChanges();
  });

  it('uses table view models without leaking PO-UI selection into domain orders', () => {
    component.selectRow(component.items[0]);

    expect(component.items[0].$selected).toBe(true);
    expect('$selected' in orders[0]).toBe(false);
  });

  it('keeps only the latest selected order and ignores stale unselect events', () => {
    const emissions: string[][] = [];
    component.selectionChange.subscribe((ids) => emissions.push([...ids]));

    component.selectRow(component.items[0]);
    component.selectRow(component.items[1]);
    component.unselectRow(component.items[0]);
    component.unselectRow(component.items[1]);

    expect(emissions).toEqual([['first'], ['second'], []]);
  });

  it('gates opening until at least one order is selected', () => {
    expect(component.openDisabled).toBe(true);

    component.selectRow(component.items[0]);

    expect(component.openDisabled).toBe(false);

    component.selectedIds = new Set(orders.map((order) => order.id));

    expect(component.openDisabled).toBe(true);
  });

  it('normalizes defensive input to one valid order in visual order', () => {
    component.selectedIds = new Set(['missing', 'second', 'first']);

    component.ngOnChanges();

    expect([...component.selectedIds]).toEqual(['first']);
    expect(component.items.map((item) => item.$selected)).toEqual([true, false]);
  });

  it('filters the already loaded orders by a partial order number', () => {
    component.updateOrderFilter(' 50002 ');

    expect(component.items.map((item) => item.ordem)).toEqual(['450002']);
    expect(component.orders).toEqual(orders);
  });

  it('focuses the filter when the loaded list appears for keyboard scanner input', async () => {
    await fixture.whenStable();

    const filterInput = fixture.nativeElement.querySelector('po-input input');
    expect(filterInput).toBeTruthy();
    expect(document.activeElement).toBe(filterInput);
  });

  it('restores every loaded order when the order filter is cleared', () => {
    component.updateOrderFilter('450001');
    component.updateOrderFilter('');

    expect(component.items.map((item) => item.ordem)).toEqual(['450001', '450002']);
  });

  it('clears the filter when a new orders result replaces the current list', () => {
    component.updateOrderFilter('450001');

    fixture.componentRef.setInput('orders', [
      { id: 'third', ordem: '460003', itemOp: 'ITEM-3 / OP-3', operacao: '30', split: '01' },
    ]);
    fixture.detectChanges();

    expect(component.orderFilter).toBe('');
    expect(component.items.map((item) => item.ordem)).toEqual(['460003']);
  });

  it('clears a selected order when the filter hides it', () => {
    const emissions: string[][] = [];
    component.selectionChange.subscribe((ids) => emissions.push([...ids]));
    component.selectRow(component.items[0]);

    component.updateOrderFilter('450002');

    expect(emissions).toEqual([['first'], []]);
    expect(component.selectedIds.size).toBe(0);
    expect(component.openDisabled).toBe(true);
  });

  it('distinguishes an empty source list from a filter without matches', () => {
    component.updateOrderFilter('999999');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma ordem encontrada para o filtro informado.',
    );

    fixture.componentRef.setInput('orders', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma ordem liberada para este Centro de Trabalho.',
    );
  });

  it('renders the exact approved empty state', () => {
    component.orders = [];
    component.ngOnChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Nenhuma ordem liberada para este Centro de Trabalho.',
    );
    expect(fixture.debugElement.query(By.css('po-button')).componentInstance.disabled).toBe(true);
  });
});
