import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PoButtonModule,
  PoFieldModule,
  PoSelectOption,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { LoadingIndicator } from '../../../../shared/components/loading-indicator/loading-indicator';
import {
  ResponsavelParada,
  TipoResponsavelParada,
} from '../../models/reporte-paradas.model';

@Component({
  selector: 'app-responsavel-parada-select',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoWidgetModule, LoadingIndicator],
  templateUrl: './responsavel-parada-select.html',
  styleUrls: ['./responsavel-parada-select.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResponsavelParadaSelect {
  @Input() responsibles: ReadonlyArray<ResponsavelParada> = [];
  @Input() responsibleType: TipoResponsavelParada = 'OPERADOR';
  @Input() responsibleCode = '';
  @Input() responsibleTypeLocked = false;
  @Input() loading = false;
  @Input() disabled = false;
  @Input() errorMessage = '';

  @Output() responsibleTypeChange = new EventEmitter<TipoResponsavelParada>();
  @Output() responsibleCodeChange = new EventEmitter<string>();
  @Output() retry = new EventEmitter<void>();

  readonly typeOptions: ReadonlyArray<PoSelectOption> = [
    { value: 'OPERADOR', label: 'Operador' },
    { value: 'EQUIPE', label: 'Equipe' },
  ];

  get responsibleOptions(): ReadonlyArray<PoSelectOption> {
    const unique = new Map<string, ResponsavelParada>();
    for (const responsible of this.responsibles) {
      if (responsible.tipo !== this.responsibleType) {
        continue;
      }
      const code = this.normalizeCode(responsible.codigo);
      unique.set(`${responsible.tipo}|${code}`, { ...responsible, codigo: code });
    }
    return [...unique.values()].map(responsible => ({
      value: responsible.codigo,
      label: `${responsible.codigo} - ${responsible.nome}`,
    }));
  }

  get emptyMessage(): string {
    return this.responsibleType === 'OPERADOR'
      ? 'Nenhum operador elegível para este contexto.'
      : 'Nenhuma equipe elegível para este contexto.';
  }

  changeType(value: string | null | undefined): void {
    if (value === 'OPERADOR' || value === 'EQUIPE') {
      this.responsibleTypeChange.emit(value);
    }
  }

  changeResponsible(value: string | null | undefined): void {
    this.responsibleCodeChange.emit(
      this.responsibleType === 'OPERADOR' ? value ?? '' : this.normalizeCode(value ?? ''),
    );
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }
}
