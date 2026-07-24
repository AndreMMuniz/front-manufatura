import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoSelectOption, PoWidgetModule } from '@po-ui/ng-components';

import { WorkCenter } from '../../../shop-floor/models/work-center';
import { ResponsavelBatelada } from '../../models/reporta-batelada.model';

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
  @Input() responsavel: ResponsavelBatelada | null = null;
  @Input() disabled = false;
  @Input() startedAt: Date | null = null;

  @Output() responsavelChange = new EventEmitter<ResponsavelBatelada | null>();
  @Output() gerenciarEquipe = new EventEmitter<HTMLElement | null>();

  get options(): ReadonlyArray<PoSelectOption> {
    return this.responsaveis.map(item => ({
      value: this.key(item),
      label: `${item.tipo === 'OPERADOR' ? 'Operador' : 'Equipe'} — ${item.codigo} - ${item.nome}`,
    }));
  }

  get responsavelKey(): string {
    return this.responsavel ? this.key(this.responsavel) : '';
  }

  changeResponsavel(value: string): void {
    if (!this.disabled) {
      const options = this.options;
      const selected = options.find(option => option.value === value);
      const index = selected ? options.indexOf(selected) : -1;
      this.responsavelChange.emit(index >= 0 ? { ...this.responsaveis[index] } : null);
    }
  }

  onGerenciarEquipe(): void {
    this.gerenciarEquipe.emit(
      typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
    );
  }

  private key(responsavel: ResponsavelBatelada): string {
    return JSON.stringify([responsavel.tipo, responsavel.codigo]);
  }
}
