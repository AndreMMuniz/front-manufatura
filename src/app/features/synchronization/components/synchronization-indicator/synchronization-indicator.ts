import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { PoIconModule } from '@po-ui/ng-components';

import { ConnectivityService } from '../../../../core/offline/services/connectivity.service';
import {
  buildSynchronizationIndicatorMessage,
} from '../../models/synchronization-view.model';
import {
  SynchronizationCenterService,
} from '../../services/synchronization-center.service';

@Component({
  selector: 'app-synchronization-indicator',
  imports: [PoIconModule],
  templateUrl: './synchronization-indicator.html',
  styleUrl: './synchronization-indicator.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SynchronizationIndicator {
  private readonly center = inject(SynchronizationCenterService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly router = inject(Router);
  private readonly state = toSignal(this.center.state$, {
    initialValue: this.center.snapshot,
  });
  private readonly online = toSignal(this.connectivity.changes$, {
    initialValue: this.connectivity.onlineHint,
  });

  readonly message = computed(() => {
    const state = this.state();
    return buildSynchronizationIndicatorMessage({
      readState: state.readState === 'idle' ? 'loading' : state.readState,
      onlineHint: this.online(),
      counts: state.counts,
    });
  });

  readonly icon = computed(() => {
    const state = this.state();
    if (state.readState === 'error' || state.readState === 'unavailable' || state.counts.error) {
      return 'an an-warning';
    }
    if (!this.online()) return 'an an-wifi-slash';
    if (state.counts.syncing) return 'an an-arrows-clockwise';
    if (state.counts.pending) return 'an an-clock';
    return 'an an-check-circle';
  });

  readonly accessibleName = computed(() => {
    const counts = this.state().counts;
    return `Sincronização. ${this.message()}. ${counts.pending} pendências. ${counts.error} erros.`;
  });

  readonly pending = computed(() => this.state().counts.pending);
  readonly errors = computed(() => this.state().counts.error);

  open(): void {
    void this.router.navigateByUrl('/synchronization');
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.open();
  }
}
