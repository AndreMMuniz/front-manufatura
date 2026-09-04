import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoSelectOption, PoWidgetModule } from '@po-ui/ng-components';

import { WorkCenter } from '../../../shop-floor/models/work-center';
import {
  ResponsavelBatelada,
  TipoResponsavelBatelada,
} from '../../models/reporta-batelada.model';

@Component({
  selector: 'app-informacoes-batelada',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './informacoes-batelada.html',
  styleUrls: ['./informacoes-batelada.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InformacoesBatelada {
  @Input() workCenter: WorkCenter | null = null;
  @Input() responsaveis: ReadonlyArray<ResponsavelBatelada> = [];
  @Input() tipoResponsavel: TipoResponsavelBatelada = 'OPERADOR';
  @Input() responsavel: ResponsavelBatelada | null = null;
  @Input() disabled = false;
  @Input() teamControlsDisabled = false;
  @Input() startedAt: Date | null = null;

  @Output() tipoResponsavelChange = new EventEmitter<TipoResponsavelBatelada>();
  @Output() responsavelChange = new EventEmitter<ResponsavelBatelada | null>();
  @Output() gerenciarEquipe = new EventEmitter<HTMLElement | null>();

  readonly tipoOptions: ReadonlyArray<PoSelectOption> = [
    { label: 'Operador', value: 'OPERADOR' },
    { label: 'Equipe', value: 'EQUIPE' },
  ];

  get equipeOptions(): ReadonlyArray<PoSelectOption> {
    return this.responsaveis.filter(item => item.tipo === 'EQUIPE').map(item => ({
      value: this.key(item),
      label: `${item.codigo} - ${item.nome}`,
    }));
  }

  get responsavelKey(): string {
    return this.responsavel ? this.key(this.responsavel) : '';
  }

  get operadorCodigo(): string {
    return this.responsavel?.tipo === 'OPERADOR' ? this.responsavel.codigo : '';
  }

  changeTipoResponsavel(value: string): void {
    if (!this.disabled && (value === 'OPERADOR' || value === 'EQUIPE')) {
      this.tipoResponsavelChange.emit(value);
    }
  }

  changeResponsavel(value: string): void {
    if (!this.disabled && !this.teamControlsDisabled && this.tipoResponsavel === 'EQUIPE') {
      const options = this.equipeOptions;
      const selected = options.find(option => option.value === value);
      const index = selected ? options.indexOf(selected) : -1;
      const equipes = this.responsaveis.filter(item => item.tipo === 'EQUIPE');
      this.responsavelChange.emit(index >= 0 ? { ...equipes[index] } : null);
    }
  }

  changeOperador(codigo: string): void {
    if (!this.disabled && this.tipoResponsavel === 'OPERADOR') {
      this.responsavelChange.emit(codigo.trim()
        ? { tipo: 'OPERADOR', codigo, nome: codigo }
        : null);
    }
  }

  onGerenciarEquipe(): void {
    if (this.tipoResponsavel !== 'EQUIPE' || this.disabled || this.teamControlsDisabled) {
      return;
    }
    this.gerenciarEquipe.emit(
      typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
    );
  }

  private key(responsavel: ResponsavelBatelada): string {
    return JSON.stringify([responsavel.tipo, responsavel.codigo]);
  }
}
