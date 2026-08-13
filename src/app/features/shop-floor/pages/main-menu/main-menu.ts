import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { PoIconModule, PoPageModule } from '@po-ui/ng-components';

import { navigationForPermissions } from '../../../../core/navigation/app-navigation';
import { AuthSessionService } from '../../../../core/auth/auth-session.service';

@Component({
  selector: 'app-main-menu',
  imports: [RouterLink, PoIconModule, PoPageModule],
  templateUrl: './main-menu.html',
  styleUrls: ['./main-menu.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainMenuPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authSession = inject(AuthSessionService);

  get modules() {
    return navigationForPermissions(this.authSession.currentUser?.permissoes ?? []);
  }

  get accessDenied(): boolean {
    return this.route.snapshot.queryParamMap.get('accessDenied') === '1';
  }

  navigateWithSpace(event: KeyboardEvent, route: string): void {
    event.preventDefault();
    void this.router.navigateByUrl(route).catch(() => undefined);
  }
}
