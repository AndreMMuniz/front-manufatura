import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

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

  get isAuthenticated(): boolean {
    return this.authSession.isAuthenticated();
  }

  get toolbarTitle(): string {
    const user = this.authSession.currentUser;
    return user ? `Plano de Controle CQ - ${user.username}` : 'Plano de Controle CQ';
  }

  get menus(): Array<PoMenuItem> {
    const items: PoMenuItem[] = [
      { label: 'Plano Controle CQ', action: () => this.router.navigate(['/quality-control']) },
    ];

    if (this.isAuthenticated) {
      items.push({
        label: 'Sair da sessao mock',
        action: () => this.logout(),
      });
    }

    return items;
  }

  logout(): void {
    this.authSession.logout();
    this.router.navigate(['/login']);
  }
}
