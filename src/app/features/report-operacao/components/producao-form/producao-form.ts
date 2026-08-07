import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { ReportOperacao } from '../../models/report-operacao.model';

@Component({
  selector: 'app-producao-form',
  imports: [FormsModule, PoFieldModule, PoWidgetModule],
  templateUrl: './producao-form.html',
  styleUrls: ['./producao-form.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProducaoForm {
  @Input() operacao: ReportOperacao | null = null;
}
