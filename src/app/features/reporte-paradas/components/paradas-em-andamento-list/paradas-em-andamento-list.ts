import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { PoButtonModule } from '@po-ui/ng-components';

import { StopEntry, StopId } from '../../models/reporte-paradas.model';
import {
  combineLocalDateTime,
  durationMinutes,
  formatDuration,
} from '../../models/reporte-paradas-time';

@Component({
  selector: 'app-paradas-em-andamento-list',
  imports: [PoButtonModule],
  templateUrl: './paradas-em-andamento-list.html',
  styleUrls: ['./paradas-em-andamento-list.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParadasEmAndamentoList {
  @Input() stops: ReadonlyArray<StopEntry> = [];
  @Input() selectedStopId: StopId | null = null;
  @Input() now = new Date();
  @Input() loading = false;
  @Input() disabled = false;
  @Input() errorMessage = '';

  @Output() selectStop = new EventEmitter<StopId>();
  @Output() retry = new EventEmitter<void>();

  @ViewChildren('stopButton') private stopButtons?: QueryList<ElementRef<HTMLButtonElement>>;

  duration(stop: StopEntry): string {
    const start = combineLocalDateTime(stop.startDate, stop.startTime);
    return formatDuration(start ? durationMinutes(start, this.now) : 0);
  }

  responsibleType(stop: StopEntry): string {
    return stop.responsible.tipo === 'OPERADOR' ? 'Operador' : 'Equipe';
  }

  startLabel(stop: StopEntry): string {
    const date = stop.startDate;
    return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()} ${stop.startTime}`;
  }

  accessibleName(stop: StopEntry): string {
    const selected = this.selectedStopId === stop.id ? 'Selecionada.' : 'Não selecionada.';
    return `${stop.reason.description}. Início ${this.startLabel(stop)}. ${this.responsibleType(stop)} ${stop.responsible.nome}. Duração ${this.duration(stop)}. Sincronização ${this.syncStatusLabel(stop)}. ${selected}`;
  }

  syncStatusLabel(stop: StopEntry): string {
    switch (stop.syncStatus) {
      case 'SYNCING': return 'sincronizando';
      case 'SYNCED': return 'sincronizada';
      case 'RETRY_WAIT': return 'aguardando nova tentativa';
      case 'BLOCKED_AUTH': return 'aguardando autorização';
      case 'BLOCKED_DEPENDENCY': return 'aguardando dependência';
      case 'ERROR': return 'erro de sincronização';
      default: return 'pendente';
    }
  }

  focusStop(stopId: StopId): void {
    this.stopButtons
      ?.find(button => button.nativeElement.dataset['stopId'] === String(stopId))
      ?.nativeElement.focus();
  }

  focusFirst(): void {
    this.stopButtons?.first?.nativeElement.focus();
  }
}
