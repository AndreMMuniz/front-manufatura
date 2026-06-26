import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';

import { PoMenuItem, PoMenuModule, PoPageModule, PoToolbarModule } from '@po-ui/ng-components';

import { AuthSessionService } from './core/auth/auth-session.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, PoToolbarModule, PoMenuModule, PoPageModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App {
  private readonly router = inject(Router);
  private readonly authSession = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.authSession.session$
      .pipe(
        // Skip the initial value so we only react to logout *transitions*
        // — not to the unauthenticated boot state, which would steal the
        // initial navigation from every page test / boot scenario.
        skip(1),
        filter(session => session === null),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.router.url.split(/[?#]/)[0] !== '/login') {
          void this.router.navigate(['/login']).catch(reason => {
            // Navigation may be cancelled by a concurrent navigation; the
            // session state is already null, so any subsequent navigation
            // to a guarded route will redirect to /login naturally.
            // eslint-disable-next-line no-console
            console.error('Logout redirect to /login failed', reason);
          });
        }
      });
  }

  get isAuthenticated(): boolean {
    return this.authSession.isAuthenticated();
  }

  get toolbarTitle(): string {
    const user = this.authSession.currentUser;
    return user ? `Plano de Controle CQ - ${user.username}` : 'Plano de Controle CQ';
  }

  get menus(): Array<PoMenuItem> {
    const items: PoMenuItem[] = [
      { label: 'Menu Principal', action: () => this.router.navigate(['/menu']) },
      { label: 'Plano Controle CQ', action: () => this.router.navigate(['/quality-control']) },
    ];

    if (this.isAuthenticated) {
      items.push({
        label: 'Sair da sessão mock',
        action: () => this.logout(),
      });
    }

    return items;
  }

  logout(): void {
    this.authSession.logout();
    // The session$ subscription drives the redirect to /login automatically;
    // no explicit navigation here keeps logout behavior consistent with
    // other call sites (e.g. LoginPage.logout()).
  }
}
