import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-sfc-placeholder',
  imports: [PoButtonModule, PoPageModule, PoWidgetModule],
  templateUrl: './sfc-placeholder.html',
  styleUrls: ['./sfc-placeholder.css'],
})
export class SfcPlaceholderPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly title = this.route.snapshot.data['title'] ?? 'Modulo SFC';
  readonly description = this.route.snapshot.data['description'] ?? 'Este fluxo sera implementado em uma etapa futura.';

  backToMenu(): void {
    void this.router.navigate(['/menu']);
  }
}
