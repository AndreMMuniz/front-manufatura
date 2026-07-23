import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import {
  ReportOperacao,
  ResponsavelOperacao,
  TipoResponsavelOperacao,
} from '../../models/report-operacao.model';

@Component({
  selector: 'app-operacao-info-card',
  imports: [FormsModule, PoFieldModule, PoWidgetModule],
  templateUrl: './operacao-info-card.html',
  styleUrls: ['./operacao-info-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperacaoInfoCard {
  @Input() operacao: ReportOperacao | null = null;
  @Input() responsaveis: ReadonlyArray<ResponsavelOperacao> = [];
  @Input() tipoResponsavel: TipoResponsavelOperacao = 'OPERADOR';
  @Input() responsavelCodigo = '';
  @Input() responsavelDisabled = true;

  @Output() tipoResponsavelChange = new EventEmitter<TipoResponsavelOperacao>();
  @Output() responsavelChange = new EventEmitter<string>();

  readonly tipoOptions = [
    { label: 'Operador', value: 'OPERADOR' },
    { label: 'Equipe', value: 'EQUIPE' },
  ];

  get responsavelOptions(): ReadonlyArray<{ label: string; value: string }> {
    return this.responsaveis
      .filter(responsavel => responsavel.tipo === this.tipoResponsavel)
      .map(responsavel => ({
        label: `${responsavel.codigo} - ${responsavel.nome}`,
        value: responsavel.codigo,
      }));
  }
}
