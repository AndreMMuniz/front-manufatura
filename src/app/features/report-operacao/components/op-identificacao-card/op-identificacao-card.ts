import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { ConsultaOPRequest } from '../../interfaces/report-operacao.dto';

@Component({
  selector: 'app-op-identificacao-card',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './op-identificacao-card.html',
  styleUrls: ['./op-identificacao-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpIdentificacaoCard {
  @Input() ordem = '';
  @Input() op = '';
  @Input() split = '';
  @Input() disabled = false;
  @Input() loading = false;

  @Output() consulta = new EventEmitter<ConsultaOPRequest>();
  @Output() scanner = new EventEmitter<void>();
  @Output() ordemChange = new EventEmitter<string>();
  @Output() opChange = new EventEmitter<string>();
  @Output() splitChange = new EventEmitter<string>();

  get canConsultar(): boolean {
    return Boolean(this.ordem.trim() && this.op.trim() && !this.disabled && !this.loading);
  }

  onSubmit(): void {
    if (!this.canConsultar) {
      return;
    }

    this.consulta.emit({
      ordem: this.ordem.trim(),
      op: this.op.trim(),
      split: this.split.trim(),
    });
  }
}
