import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { PoTableColumn, PoTableModule } from '@po-ui/ng-components';

import { Operador } from '../../models/operador.model';

@Component({
  selector: 'app-operadores-table',
  imports: [PoTableModule],
  templateUrl: './operadores-table.html',
  styleUrls: ['./operadores-table.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperadoresTable {
  @Input({ required: true }) operadores: ReadonlyArray<Operador> = [];

  readonly columns: ReadonlyArray<PoTableColumn> = [
    { property: 'codigo', label: 'Código', width: '120px' },
    { property: 'nome', label: 'Nome' },
  ];
}
