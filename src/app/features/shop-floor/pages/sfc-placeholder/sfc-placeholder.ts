import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';
import { ConnectivityService } from '../../../../core/offline/services/connectivity.service';
import { messageForOfflineAvailability } from '../../../../core/offline/models/offline-availability';

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

  readonly title = this.route.snapshot.data['title'] ?? 'Modulo SFC';
  readonly description = this.route.snapshot.data['description'] ?? 'Este fluxo sera implementado em uma etapa futura.';
  readonly requiresOnlineData = this.route.snapshot.data['requiresOnlineData'] === true;

  get unavailableMessage(): string {
    return this.requiresOnlineData && !this.connectivity.onlineHint
      ? messageForOfflineAvailability('query')
      : '';
  }

  backToDefaultModule(): void {
    void this.router.navigate(['/quality-control']);
  }
}
