import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { ReportOperacao } from '../../models/report-operacao.model';

@Component({
  selector: 'app-op-detalhes-card',
  imports: [FormsModule, PoFieldModule, PoWidgetModule],
  templateUrl: './op-detalhes-card.html',
  styleUrls: ['./op-detalhes-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpDetalhesCard {
  @Input() operacao: ReportOperacao | null = null;
}
