import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import {
  PoButtonModule,
  PoLoadingModule,
  PoTableColumn,
  PoTableModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { OrdemLiberadaBatelada } from '../../models/reporta-batelada.model';

export interface OrdemBateladaTableItem extends OrdemLiberadaBatelada {
  readonly $selected: boolean;
}

@Component({
  selector: 'app-ordens-centro-batelada-list',
  imports: [PoButtonModule, PoLoadingModule, PoTableModule, PoWidgetModule],
  templateUrl: './ordens-centro-list.html',
  styleUrls: ['./ordens-centro-list.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdensCentroBateladaList {
  @Input() orders: ReadonlyArray<OrdemLiberadaBatelada> = [];
  @Input() selectedIds: ReadonlySet<string> = new Set<string>();
  @Input() loading = false;
  @Input() disabled = false;
  @Input() showList = false;

  @Output() selectionChange = new EventEmitter<ReadonlySet<string>>();
  @Output() prepare = new EventEmitter<void>();

  items: ReadonlyArray<OrdemBateladaTableItem> = [];

  readonly columns: ReadonlyArray<PoTableColumn> = [
    { property: 'ordem', label: 'Ordem', width: '18%' },
    { property: 'itemOp', label: 'Item / OP', width: '38%' },
    { property: 'operacao', label: 'Operação', width: '24%' },
    { property: 'split', label: 'Split', width: '20%' },
  ];

  get prepareDisabled(): boolean {
    return this.disabled || this.loading || this.selectedIds.size === 0;
  }

  ngOnChanges(): void {
    this.syncItems();
  }

  selectRow(row: OrdemBateladaTableItem): void {
    if (!this.disabled) {
      this.setSelection(new Set([...this.selectedIds, row.id]));
    }
  }

  unselectRow(row: OrdemBateladaTableItem): void {
    if (this.disabled) {
      return;
    }
    const ids = new Set(this.selectedIds);
    ids.delete(row.id);
    this.setSelection(ids);
  }

  selectAll(): void {
    if (!this.disabled) {
      this.setSelection(new Set(this.orders.map(order => order.id)));
    }
  }

  unselectAll(): void {
    if (!this.disabled) {
      this.setSelection(new Set<string>());
    }
  }

  private setSelection(ids: ReadonlySet<string>): void {
    this.selectedIds = new Set(ids);
    this.syncItems();
    this.selectionChange.emit(new Set(this.selectedIds));
  }

  private syncItems(): void {
    this.items = this.orders.map(order => ({
      ...order,
      $selected: this.selectedIds.has(order.id),
    }));
  }
}
