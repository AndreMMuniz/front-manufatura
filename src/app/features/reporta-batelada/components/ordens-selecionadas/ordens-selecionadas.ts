import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { PoWidgetModule } from '@po-ui/ng-components';

import {
  OrdemLiberadaBatelada,
  TotaisBatelada,
  TotaisOrdemBatelada,
} from '../../models/reporta-batelada.model';

@Component({
  selector: 'app-ordens-selecionadas-batelada',
  imports: [PoWidgetModule],
  templateUrl: './ordens-selecionadas.html',
  styleUrls: ['./ordens-selecionadas.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdensSelecionadasBatelada {
  @Input() orders: ReadonlyArray<OrdemLiberadaBatelada> = [];
  @Input() totals: ReadonlyArray<TotaisOrdemBatelada> = [];
  @Input() batchTotals: TotaisBatelada = {
    quantidadeAprovada: 0,
    quantidadeRetrabalho: 0,
    quantidadeRefugo: 0,
    quantidadeTotal: 0,
  };
  @Input() locked = false;

  totalsFor(orderId: string): TotaisOrdemBatelada {
    return this.totals.find(item => item.orderId === orderId) ?? {
      orderId,
      ordem: this.orders.find(order => order.id === orderId)?.ordem ?? '',
      quantidadeAprovada: 0,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      quantidadeTotal: 0,
    };
  }

  formatQuantity(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value);
  }
}
