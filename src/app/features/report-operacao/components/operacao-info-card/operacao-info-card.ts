import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoSelectOption, PoWidgetModule } from '@po-ui/ng-components';

import {
  ReportOperacao,
  ResponsavelOperacao,
  TipoResponsavelOperacao,
} from '../../models/report-operacao.model';

@Component({
  selector: 'app-operacao-info-card',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './operacao-info-card.html',
  styleUrls: ['./operacao-info-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperacaoInfoCard {
  @Input() operacao: ReportOperacao | null = null;
  @Input() responsaveis: ReadonlyArray<ResponsavelOperacao> = [];
  @Input() tipoResponsavel: TipoResponsavelOperacao = 'OPERADOR';
  @Input() responsavelCodigo = '';
  @Input() tipoResponsavelDisabled = true;
  @Input() responsavelDisabled = true;
  @Input() loadingResponsaveis = false;
  @Input() responsaveisError = '';
  @Input() gerenciarEquipeDisabled = true;

  @Output() tipoResponsavelChange = new EventEmitter<TipoResponsavelOperacao>();
  @Output() responsavelChange = new EventEmitter<string>();
  @Output() responsavelConfirmado = new EventEmitter<void>();
  @Output() retryResponsaveis = new EventEmitter<void>();
  @Output() gerenciarEquipe = new EventEmitter<HTMLElement | null>();

  readonly tipoOptions: ReadonlyArray<PoSelectOption> = [
    { label: 'Operador', value: 'OPERADOR' },
    { label: 'Equipe', value: 'EQUIPE' },
  ];

  get responsavelOptions(): ReadonlyArray<PoSelectOption> {
    return this.responsaveis
      .filter(responsavel => responsavel.tipo === this.tipoResponsavel)
      .map(responsavel => ({
        label: `${responsavel.codigo} - ${responsavel.nome}`,
        value: responsavel.codigo,
      }));
  }

  changeTipoResponsavel(value: string): void {
    if (value === 'OPERADOR' || value === 'EQUIPE') {
      this.tipoResponsavelChange.emit(value);
    }
  }

  changeResponsavel(value: string): void {
    this.responsavelChange.emit(value ?? '');
  }

  confirmResponsavel(): void {
    this.responsavelConfirmado.emit();
  }

  onGerenciarEquipe(): void {
    this.gerenciarEquipe.emit(
      typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
    );
  }
}
