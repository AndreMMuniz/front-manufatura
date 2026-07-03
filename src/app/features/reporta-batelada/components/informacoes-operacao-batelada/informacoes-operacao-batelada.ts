import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { ProductionInformation } from '../../models/reporta-batelada.model';

@Component({
  selector: 'app-informacoes-operacao-batelada',
  imports: [FormsModule, PoFieldModule, PoWidgetModule],
  templateUrl: './informacoes-operacao-batelada.html',
  styleUrls: ['./informacoes-operacao-batelada.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InformacoesOperacaoBatelada {
  @Input() info: ProductionInformation | null = null;
}
