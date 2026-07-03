import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { BateladaItem } from '../../models/reporta-batelada.model';

@Component({
  selector: 'app-batelada-list',
  imports: [FormsModule, PoFieldModule, PoWidgetModule],
  templateUrl: './batelada-list.html',
  styleUrls: ['./batelada-list.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BateladaList {
  @Input() itens: ReadonlyArray<BateladaItem> = [];
  @Input() loading = false;
  @Input() disabled = false;

  @Output() itensChange = new EventEmitter<ReadonlyArray<BateladaItem>>();

  get allSelected(): boolean {
    return this.itens.length > 0 && this.itens.every(item => item.selected);
  }

  get selectedCount(): number {
    return this.itens.filter(item => item.selected).length;
  }

  setAll(selected: boolean): void {
    this.itensChange.emit(this.itens.map(item => ({ ...item, selected })));
  }

  updateItem(index: number, partial: Partial<BateladaItem>): void {
    this.itensChange.emit(this.itens.map((item, itemIndex) => (itemIndex === index ? { ...item, ...partial } : item)));
  }
}
