import {
  AfterViewChecked,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoIconModule, PoLoadingModule, PoPageModule } from '@po-ui/ng-components';

import {
  SynchronizationEntryView,
  SynchronizationModule,
} from '../../models/synchronization-view.model';
import { SynchronizationCenterService } from '../../services/synchronization-center.service';
import {
  ManualRetryResult,
  SyncCoordinatorService,
} from '../../../../core/offline/services/sync-coordinator.service';
import { SynchronizationRecoveryRegistry } from '../../services/synchronization-recovery-registry';
import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { SynchronizationPermissionPolicy } from '../../services/synchronization-permission.policy';
import {
  AbandonmentResult,
  SynchronizationAbandonmentService,
} from '../../services/synchronization-abandonment.service';

@Component({
  selector: 'app-synchronization-center-page',
  imports: [FormsModule, PoButtonModule, PoIconModule, PoLoadingModule, PoPageModule],
  templateUrl: './synchronization-center.html',
  styleUrl: './synchronization-center.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SynchronizationCenterPage implements AfterViewChecked {
  private readonly center = inject(SynchronizationCenterService);
  private readonly coordinator = inject(SyncCoordinatorService);
  private readonly recovery = inject(SynchronizationRecoveryRegistry);
  private readonly auth = inject(AuthSessionService);
  private readonly permission = inject(SynchronizationPermissionPolicy);
  private readonly abandonment = inject(SynchronizationAbandonmentService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private detailTrigger: HTMLElement | null = null;
  private abandonTrigger: HTMLElement | null = null;
  private abandonTriggerId: string | null = null;
  private pendingAbandonFocus: { id: string | null; fallback: HTMLElement | null } | null = null;

  readonly state = toSignal(this.center.state$, { initialValue: this.center.snapshot });
  readonly selected = signal<SynchronizationEntryView | null>(null);
  readonly busyIds = signal<ReadonlySet<string>>(new Set());
  readonly actionFeedback = signal('');
  readonly abandonTarget = signal<SynchronizationEntryView | null>(null);
  readonly abandonError = signal('');
  abandonReason = '';
  readonly totalActive = computed(() => this.state().counts.pending + this.state().counts.error);

  status = '';
  module = '';
  occurredFrom = '';
  occurredTo = '';
  identification = '';

  applyFilters(): void {
    this.center.setFilters({
      statuses: this.status ? [this.status as never] : [],
      modules: this.module ? [this.module as SynchronizationModule] : [],
      ...(this.occurredFrom
        ? { occurredFrom: new Date(`${this.occurredFrom}T00:00:00`).toISOString() }
        : {}),
      ...(this.occurredTo
        ? { occurredTo: new Date(`${this.occurredTo}T23:59:59.999`).toISOString() }
        : {}),
      ...(this.identification.trim() ? { identification: this.identification.trim() } : {}),
    });
  }

  clearFilters(): void {
    this.status = '';
    this.module = '';
    this.occurredFrom = '';
    this.occurredTo = '';
    this.identification = '';
    this.center.setFilters({ statuses: [], modules: [] });
  }

  retryLoad(): void {
    void this.center.refresh();
  }

  loadMore(): void {
    void this.center.loadMore();
  }

  async retry(item: SynchronizationEntryView): Promise<void> {
    if (this.busyIds().has(item.localId)) return;
    this.busyIds.update(current => new Set([...current, item.localId]));
    this.actionFeedback.set('');
    let result: ManualRetryResult;
    try {
      result = await this.coordinator.retryError(item.localId);
    } finally {
      this.busyIds.update(current => {
        const next = new Set(current);
        next.delete(item.localId);
        return next;
      });
    }
    this.actionFeedback.set(retryMessage(result));
    await this.center.refresh();
  }

  async correct(item: SynchronizationEntryView): Promise<void> {
    if (this.busyIds().has(item.localId)) return;
    this.busyIds.update(current => new Set([...current, item.localId]));
    const result = await this.recovery.openCorrection(item.localId);
    this.busyIds.update(current => {
      const next = new Set(current);
      next.delete(item.localId);
      return next;
    });
    if (result !== 'opened') {
      this.actionFeedback.set(
        'A correção não está mais disponível. O registro original permanece preservado.',
      );
      await this.center.refresh();
    }
  }

  canAbandon(): boolean {
    return this.permission.canAbandon(this.auth.currentUser);
  }

  openAbandon(item: SynchronizationEntryView, event: Event): void {
    if (!this.canAbandon() || this.busyIds().has(item.localId)) return;
    this.abandonTrigger = event.currentTarget as HTMLElement;
    this.abandonTriggerId = item.localId;
    this.abandonReason = '';
    this.abandonError.set('');
    this.abandonTarget.set(item);
    queueMicrotask(() => {
      this.host.nativeElement.querySelector<HTMLElement>('#sync-abandon-reason')?.focus();
    });
  }

  cancelAbandon(): void {
    if (!this.abandonTarget() || this.isAbandoning()) return;
    const trigger = this.abandonTrigger;
    this.abandonTarget.set(null);
    this.abandonReason = '';
    this.abandonError.set('');
    trigger?.focus();
    this.abandonTrigger = null;
    this.abandonTriggerId = null;
  }

  isAbandoning(): boolean {
    const target = this.abandonTarget();
    return Boolean(target && this.busyIds().has(target.localId));
  }

  async confirmAbandon(): Promise<void> {
    const target = this.abandonTarget();
    if (!target || this.busyIds().has(target.localId)) return;
    this.busyIds.update(current => new Set([...current, target.localId]));
    this.abandonError.set('');
    const result = await this.abandonment.abandon(target.localId, this.abandonReason);
    this.busyIds.update(current => {
      const next = new Set(current);
      next.delete(target.localId);
      return next;
    });
    if (result === 'abandoned') {
      const trigger = this.abandonTrigger;
      const triggerId = this.abandonTriggerId;
      this.abandonTarget.set(null);
      this.abandonReason = '';
      this.abandonTrigger = null;
      this.abandonTriggerId = null;
      this.actionFeedback.set('Registro abandonado com justificativa e mantido no histórico.');
      await this.center.refresh();
      this.pendingAbandonFocus = { id: triggerId, fallback: trigger };
      this.changeDetector.markForCheck();
      return;
    }
    this.abandonError.set(abandonMessage(result));
    if (result !== 'invalid-reason' && result !== 'secret-detected') {
      await this.center.refresh();
    }
  }

  openDetail(item: SynchronizationEntryView, event: Event): void {
    this.detailTrigger = event.currentTarget as HTMLElement;
    this.selected.set(item);
    queueMicrotask(() => {
      this.host.nativeElement
        .querySelector<HTMLElement>('[data-testid="sync-close-detail"]')
        ?.focus();
    });
  }

  closeDetail(): void {
    if (!this.selected()) return;
    const trigger = this.detailTrigger;
    this.selected.set(null);
    trigger?.focus();
    this.detailTrigger = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.abandonTarget()) this.cancelAbandon();
    else this.closeDetail();
  }

  ngAfterViewChecked(): void {
    const pending = this.pendingAbandonFocus;
    if (!pending || this.abandonTarget()) return;
    const currentTrigger = pending.id
      ? [...this.host.nativeElement.querySelectorAll<HTMLElement>(
          '[data-testid^="sync-abandon-"]',
        )].find(element => element.dataset['testid'] === `sync-abandon-${pending.id}`)
      : null;
    const recordTrigger = pending.id
      ? this.host.nativeElement.querySelector<HTMLElement>(
          `[data-testid="sync-detail-${escapeAttributeValue(pending.id)}"]`,
        )
      : null;
    const target = currentTrigger
      ?? recordTrigger
      ?? (pending.fallback?.isConnected ? pending.fallback : null);
    if (target) {
      target.focus();
      this.pendingAbandonFocus = null;
    }
  }

  formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Horário não identificado'
      : date.toLocaleString('pt-BR');
  }
}

function escapeAttributeValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function retryMessage(result: ManualRetryResult): string {
  switch (result) {
    case 'queued':
      return 'Registro preservado e preparado para nova tentativa de envio.';
    case 'no-credential':
      return 'Registro preservado. Restabeleça a sessão e a conexão adequada antes de tentar novamente.';
    case 'stale-or-ineligible':
      return 'O registro mudou em outra ação ou não aceita mais retry. A lista foi atualizada.';
    case 'storage-error':
      return 'Não foi possível preparar o retry no armazenamento local. O registro permanece preservado.';
  }
}

function abandonMessage(result: AbandonmentResult): string {
  switch (result) {
    case 'invalid-reason':
      return 'Informe uma justificativa entre 10 e 500 caracteres.';
    case 'secret-detected':
      return 'A justificativa parece conter senha, token ou credencial. Remova o segredo.';
    case 'denied':
      return 'Sua sessão não possui permissão para abandonar este registro.';
    case 'has-dependents':
      return 'Resolva primeiro os registros que dependem deste comando.';
    case 'has-later-commands':
      return 'Resolva a cauda mais recente deste processo antes de abandonar este registro.';
    case 'stale-or-ineligible':
      return 'O registro mudou ou não pode mais ser abandonado.';
    case 'storage-error':
      return 'Falha local: o registro permanece preservado e ativo.';
    case 'abandoned':
      return '';
  }
}
