import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { ReportOperacao } from '../../models/report-operacao.model';

@Component({
  selector: 'app-operacao-info-card',
  imports: [FormsModule, PoFieldModule, PoWidgetModule],
  templateUrl: './operacao-info-card.html',
  styleUrls: ['./operacao-info-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperacaoInfoCard {
  @Input() operacao: ReportOperacao | null = null;
}
