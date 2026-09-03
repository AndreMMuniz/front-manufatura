import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PoButtonModule,
  PoFieldModule,
  PoTableColumn,
  PoTableModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { LoadingIndicator } from '../../../../shared/components/loading-indicator/loading-indicator';
import { OrdemCentroTrabalho } from '../../models/report-operacao.model';

export interface OrdemCentroTrabalhoTableItem extends OrdemCentroTrabalho {
  $selected: boolean;
}

@Component({
  selector: 'app-ordens-centro-list',
  imports: [
    FormsModule,
    PoButtonModule,
    PoFieldModule,
    PoTableModule,
    PoWidgetModule,
    LoadingIndicator,
  ],
  templateUrl: './ordens-centro-list.html',
  styleUrls: ['./ordens-centro-list.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdensCentroList {
  @Input() orders: ReadonlyArray<OrdemCentroTrabalho> = [];
  @Input() selectedIds: ReadonlySet<string> = new Set<string>();
  @Input() loading = false;
  @Input() disabled = false;
  @Input() showList = false;

  @Output() selectionChange = new EventEmitter<ReadonlySet<string>>();
  @Output() open = new EventEmitter<void>();

  private ordersSource: ReadonlyArray<OrdemCentroTrabalho> = this.orders;

  orderFilter = '';
  items: ReadonlyArray<OrdemCentroTrabalhoTableItem> = [];

  readonly columns: ReadonlyArray<PoTableColumn> = [
    { property: 'ordem', label: 'Ordem', width: '18%' },
    { property: 'itemOp', label: 'Item / OP', width: '38%' },
    { property: 'operacao', label: 'Operação', width: '24%' },
    { property: 'split', label: 'Split', width: '20%' },
  ];

  get openDisabled(): boolean {
    return this.disabled || this.loading || this.selectedIds.size !== 1;
  }

  ngOnChanges(): void {
    if (this.orders !== this.ordersSource) {
      this.ordersSource = this.orders;
      this.orderFilter = '';
    }

    const selectedOrder = this.orders.find((order) => this.selectedIds.has(order.id));
    this.selectedIds = new Set(selectedOrder ? [selectedOrder.id] : []);
    this.syncItems();
  }

  updateOrderFilter(value: string): void {
    this.orderFilter = value;
    const visibleOrderIds = new Set(this.filteredOrders().map((order) => order.id));

    if ([...this.selectedIds].some((id) => !visibleOrderIds.has(id))) {
      this.setSelection(new Set<string>());
      return;
    }

    this.syncItems();
  }

  selectRow(row: OrdemCentroTrabalhoTableItem): void {
    this.setSelection(new Set([row.id]));
  }

  unselectRow(row: OrdemCentroTrabalhoTableItem): void {
    if (this.selectedIds.has(row.id)) {
      this.setSelection(new Set<string>());
    }
  }

  private setSelection(ids: ReadonlySet<string>): void {
    this.selectedIds = new Set(ids);
    this.syncItems();
    this.selectionChange.emit(new Set(this.selectedIds));
  }

  private filteredOrders(): ReadonlyArray<OrdemCentroTrabalho> {
    const filter = this.orderFilter.trim();
    return filter ? this.orders.filter((order) => order.ordem.includes(filter)) : this.orders;
  }

  private syncItems(): void {
    this.items = this.filteredOrders().map((order) => ({
      ...order,
      $selected: this.selectedIds.has(order.id),
    }));
  }
}
