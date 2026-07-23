import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { ReportOperacao } from '../../models/report-operacao.model';

export interface ProducaoChange {
  readonly dataInicio?: Date;
  readonly horaInicio: string;
  readonly dataFim?: Date;
  readonly horaFim: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
}

@Component({
  selector: 'app-producao-form',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './producao-form.html',
  styleUrls: ['./producao-form.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProducaoForm {
  @Input() operacao: ReportOperacao | null = null;
  @Input() disabled = true;
  @Input() refugoDisabled = true;
  @Input() retrabalhoDisabled = true;

  @Output() producaoChange = new EventEmitter<ProducaoChange>();
  @Output() editarRefugo = new EventEmitter<void>();
  @Output() editarRetrabalho = new EventEmitter<void>();

  update(partial: Partial<ProducaoChange>): void {
    if (!this.operacao) {
      return;
    }

    this.producaoChange.emit({
      dataInicio: this.operacao.dataInicio,
      horaInicio: this.operacao.horaInicio,
      dataFim: this.operacao.dataFim,
      horaFim: this.operacao.horaFim,
      quantidadeAprovada: this.operacao.quantidadeAprovada,
      quantidadeRetrabalho: this.operacao.quantidadeRetrabalho,
      ...partial,
    });
  }

  updateEndDate(value: Date | string | null | undefined): void {
    this.update({ dataFim: this.toLocalDate(value) });
  }

  private toLocalDate(value: Date | string | null | undefined): Date | undefined {
    if (value instanceof Date) {
      return new Date(value);
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
    if (!match) {
      return undefined;
    }

    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
}
