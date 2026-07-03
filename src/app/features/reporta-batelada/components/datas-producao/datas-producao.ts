import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-datas-producao',
  imports: [FormsModule, PoFieldModule, PoWidgetModule],
  templateUrl: './datas-producao.html',
  styleUrls: ['./datas-producao.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatasProducao {
  @Input() dataInicio?: Date;
  @Input() horaInicio = '';
  @Input() dataFim?: Date;
  @Input() horaFim = '';
  @Input() disabled = true;

  @Output() datasChange = new EventEmitter<{
    readonly dataInicio?: Date;
    readonly horaInicio: string;
    readonly dataFim?: Date;
    readonly horaFim: string;
  }>();

  update(partial: Partial<{ dataInicio?: Date; horaInicio: string; dataFim?: Date; horaFim: string }>): void {
    this.datasChange.emit({
      dataInicio: this.dataInicio,
      horaInicio: this.horaInicio,
      dataFim: this.dataFim,
      horaFim: this.horaFim,
      ...partial,
    });
  }
}
