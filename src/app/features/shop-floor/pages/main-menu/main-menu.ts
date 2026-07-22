import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { PoIconModule, PoPageModule } from '@po-ui/ng-components';

import { APP_MODULE_NAVIGATION } from '../../../../core/navigation/app-navigation';

@Component({
  selector: 'app-main-menu',
  imports: [RouterLink, PoIconModule, PoPageModule],
  templateUrl: './main-menu.html',
  styleUrls: ['./main-menu.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainMenuPage {
  private readonly router = inject(Router);

  get modules() {
    return APP_MODULE_NAVIGATION;
  }

  navigateWithSpace(event: KeyboardEvent, route: string): void {
    event.preventDefault();
    void this.router.navigateByUrl(route).catch(() => undefined);
  }
}
