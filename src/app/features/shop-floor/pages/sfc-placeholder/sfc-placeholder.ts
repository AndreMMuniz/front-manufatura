import { Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';
import { ConnectivityService } from '../../../../core/offline/services/connectivity.service';
import { messageForOfflineAvailability } from '../../../../core/offline/models/offline-availability';
import { OnlineDataAvailabilityService } from '../../../../core/offline/services/online-data-availability.service';

@Component({
  selector: 'app-sfc-placeholder',
  imports: [PoButtonModule, PoPageModule, PoWidgetModule],
  templateUrl: './sfc-placeholder.html',
  styleUrls: ['./sfc-placeholder.css'],
})
export class SfcPlaceholderPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly connectivity = inject(ConnectivityService);
  private readonly onlineData = inject(OnlineDataAvailabilityService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly onlineDataAvailable = signal<boolean | null>(null);

  readonly title = this.route.snapshot.data['title'] ?? 'Modulo SFC';
  readonly description = this.route.snapshot.data['description'] ?? 'Este fluxo sera implementado em uma etapa futura.';
  readonly requiresOnlineData = this.route.snapshot.data['requiresOnlineData'] === true;

  constructor() {
    afterNextRender(() => {
      this.refreshAvailability();
      this.connectivity.changes$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.refreshAvailability());
    });
  }

  get unavailableMessage(): string {
    return this.requiresOnlineData && this.onlineDataAvailable() === false
      ? messageForOfflineAvailability('query')
      : '';
  }

  refreshAvailability(): void {
    if (!this.requiresOnlineData) {
      this.onlineDataAvailable.set(true);
      return;
    }

    this.onlineData.check()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(available => this.onlineDataAvailable.set(available));
  }

  backToDefaultModule(): void {
    void this.router.navigate(['/quality-control']);
  }
}
