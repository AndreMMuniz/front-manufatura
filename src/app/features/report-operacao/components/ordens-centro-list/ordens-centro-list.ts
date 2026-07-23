import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { PoButtonModule, PoLoadingModule, PoTableColumn, PoTableModule, PoWidgetModule } from '@po-ui/ng-components';

import { OrdemCentroTrabalho } from '../../models/report-operacao.model';

export interface OrdemCentroTrabalhoTableItem extends OrdemCentroTrabalho {
  $selected: boolean;
}

@Component({
  selector: 'app-ordens-centro-list',
  imports: [PoButtonModule, PoLoadingModule, PoTableModule, PoWidgetModule],
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

  items: ReadonlyArray<OrdemCentroTrabalhoTableItem> = [];

  readonly columns: ReadonlyArray<PoTableColumn> = [
    { property: 'ordem', label: 'Ordem', width: '18%' },
    { property: 'itemOp', label: 'Item / OP', width: '38%' },
    { property: 'operacao', label: 'Operação', width: '24%' },
    { property: 'split', label: 'Split', width: '20%' },
  ];

  get openDisabled(): boolean {
    return this.disabled || this.loading || this.selectedIds.size === 0;
  }

  ngOnChanges(): void {
    this.items = this.orders.map(order => ({
      ...order,
      $selected: this.selectedIds.has(order.id),
    }));
  }

  selectRow(row: OrdemCentroTrabalhoTableItem): void {
    this.setSelection(new Set([...this.selectedIds, row.id]));
  }

  unselectRow(row: OrdemCentroTrabalhoTableItem): void {
    const ids = new Set(this.selectedIds);
    ids.delete(row.id);
    this.setSelection(ids);
  }

  selectAll(): void {
    this.setSelection(new Set(this.orders.map(order => order.id)));
  }

  unselectAll(): void {
    this.setSelection(new Set<string>());
  }

  private setSelection(ids: ReadonlySet<string>): void {
    this.selectedIds = new Set(ids);
    this.items = this.orders.map(order => ({ ...order, $selected: this.selectedIds.has(order.id) }));
    this.selectionChange.emit(new Set(this.selectedIds));
  }
}
