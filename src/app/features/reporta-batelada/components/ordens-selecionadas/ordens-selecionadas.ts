import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { PoWidgetModule } from '@po-ui/ng-components';

import { OrdemLiberadaBatelada } from '../../models/reporta-batelada.model';

@Component({
  selector: 'app-ordens-selecionadas-batelada',
  imports: [PoWidgetModule],
  templateUrl: './ordens-selecionadas.html',
  styleUrls: ['./ordens-selecionadas.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdensSelecionadasBatelada {
  @Input() orders: ReadonlyArray<OrdemLiberadaBatelada> = [];
  @Input() locked = false;
}
