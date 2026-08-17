import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
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
  @Input() dataInicio: Date | string | null = null;
  @Input() horaInicio = '';
  @Input() inicioDisabled = false;

  @Output() dataInicioChange = new EventEmitter<Date | string | null>();
  @Output() horaInicioChange = new EventEmitter<string>();
}
