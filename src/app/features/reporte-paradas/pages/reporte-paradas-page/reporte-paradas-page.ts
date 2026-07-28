import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  PoButtonModule,
  PoFieldModule,
  PoLoadingModule,
  PoNotificationService,
  PoPageModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { ProductionContext, StopEntry, StopReason } from '../../models/reporte-paradas.model';
import { ReporteParadasService } from '../../services/reporte-paradas.service';

type PageState = 'loading' | 'ready' | 'saving' | 'error';

@Component({
  selector: 'app-reporte-paradas-page',
  imports: [CommonModule, FormsModule, PoButtonModule, PoFieldModule, PoLoadingModule, PoPageModule, PoWidgetModule],
  templateUrl: './reporte-paradas-page.html',
  styleUrls: ['./reporte-paradas-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteParadasPage implements OnInit {
  private readonly service = inject(ReporteParadasService);
  private readonly notification = inject(PoNotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<PageState>('loading');
  readonly context = signal<ProductionContext | null>(null);
  readonly reasons = signal<ReadonlyArray<StopReason>>([]);
  readonly search = signal('');
  readonly selectedReasonId = signal<number | null>(null);
  readonly stops = signal<ReadonlyArray<StopEntry>>([]);
  readonly selectedStopId = signal<number | null>(null);

  readonly filteredReasons = computed(() => {
    const term = this.search().trim().toLowerCase();

    if (!term) {
      return this.reasons();
    }

    return this.reasons().filter(reason =>
      `${reason.code} ${reason.description}`.toLowerCase().includes(term),
    );
  });

  readonly selectedStop = computed(() => this.stops().find(stop => stop.id === this.selectedStopId()) ?? null);

  readonly totalDuration = computed(() => {
    const minutes = this.stops().reduce((total, stop) => total + this.service.calculateDurationMinutes(stop), 0);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}:00`;
  });

  ngOnInit(): void {
    this.context.set(this.service.getActiveContext());
    this.service
      .listReasons()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: reasons => {
          this.reasons.set(reasons);
          this.state.set('ready');
        },
        error: () => {
          this.state.set('error');
          this.notification.error('Não foi possível carregar os motivos de parada.');
        },
      });
  }

  selectReason(reason: StopReason): void {
    this.selectedReasonId.set(reason.id);
    this.search.set(`${reason.code} - ${reason.description}`);
  }

  addSelectedReason(): void {
    const reason = this.reasons().find(item => item.id === this.selectedReasonId());

    if (!reason) {
      this.notification.warning('Selecione um motivo válido.');
      return;
    }

    const stop = this.service.createStop(reason);
    this.stops.set([...this.stops(), stop]);
    this.selectedStopId.set(stop.id);
    this.selectedReasonId.set(null);
    this.search.set('');
  }

  selectStop(stop: StopEntry): void {
    this.selectedStopId.set(stop.id);
  }

  updateSelectedStop(change: Partial<StopEntry>): void {
    const selectedId = this.selectedStopId();

    if (!selectedId) {
      return;
    }

    this.stops.set(
      this.stops().map(stop =>
        stop.id === selectedId
          ? {
              ...stop,
              ...change,
            }
          : stop,
      ),
    );
  }

  duration(stop: StopEntry): string {
    return this.service.formatDuration(stop);
  }

  save(): void {
    const context = this.context();
    const validation = this.service.validateStops(this.stops(), context);

    if (validation || !context) {
      this.notification.warning(validation);
      return;
    }

    this.state.set('saving');
    this.service
      .saveStops(context, this.stops())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.notification.success(`Paradas salvas. Protocolo ${result.protocol}.`);
          void this.router.navigate([context.origin?.sourceRoute ?? '/menu']);
        },
        error: () => {
          this.state.set('error');
          this.notification.error('Não foi possível salvar as paradas. Os dados foram preservados.');
        },
      });
  }

  voltar(): void {
    void this.router.navigate([this.context()?.origin?.sourceRoute ?? '/menu']);
  }

  sair(): void {
    void this.router.navigate(['/quality-control']);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.selectedReasonId.set(null);
  }
}
