import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toSignal } from '@angular/core/rxjs-interop';
import { PRIMARY_OUTLET, Router, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';

import {
  PoIconModule,
  PoMenuItem,
  PoMenuModule,
  PoPopupModule,
  PoToolbarAction,
  PoToolbarModule,
} from '@po-ui/ng-components';

import { AuthSessionService } from './core/auth/auth-session.service';
import {
  APP_MODULE_NAVIGATION,
  navigationForPermissions,
} from './core/navigation/app-navigation';
import { ConnectivityService } from './core/offline/services/connectivity.service';
import { PwaUpdateService } from './core/offline/pwa/pwa-update.service';
import { SynchronizationIndicator } from './features/synchronization/components/synchronization-indicator/synchronization-indicator';

const APP_NAME = 'Apontamento Manufatura';

const HOME_MENU: PoMenuItem = {
  label: 'Menu Principal',
  shortLabel: 'Home',
  icon: 'an an-house-line',
  link: '/menu',
};

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    PoIconModule,
    PoMenuModule,
    PoPopupModule,
    PoToolbarModule,
    SynchronizationIndicator,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly router = inject(Router);
  private readonly authSession = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly connectivity = inject(ConnectivityService);
  private readonly pwaUpdate = inject(PwaUpdateService);
  private readonly onlineHint = toSignal(this.connectivity.changes$, {
    initialValue: this.connectivity.onlineHint,
  });
  private readonly confirmPendingUpdate = signal(false);

  readonly pwaUpdateState = this.pwaUpdate.state;
  readonly pwaUpdateFeedback = signal('');
  readonly sideMenuExpanded = signal(true);

  readonly toolbarActions: Array<PoToolbarAction> = [
    {
      label: 'Sair',
      icon: 'an an-sign-out',
      type: 'danger',
      action: () => this.logout(),
    },
  ];

  private menuPermissionsKey = '';
  private resolvedMenus: Array<PoMenuItem> = [HOME_MENU];

  get menus(): Array<PoMenuItem> {
    const permissions = this.authSession.currentUser?.permissoes ?? [];
    const permissionsKey = permissions.join('\u0000');
    if (permissionsKey === this.menuPermissionsKey) {
      return this.resolvedMenus;
    }
    const modules = navigationForPermissions(permissions);
    this.menuPermissionsKey = permissionsKey;
    this.resolvedMenus = [
      HOME_MENU,
      ...modules.map(({ label, shortLabel, icon, route }) => ({
        label,
        shortLabel,
        icon,
        link: route,
      })),
    ];
    return this.resolvedMenus;
  }

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

  get showOfflineBanner(): boolean {
    return this.connectivity.isBrowser && !this.onlineHint();
  }

  get showPwaUpdateNotice(): boolean {
    return ['ready', 'install-failed', 'unrecoverable'].includes(this.pwaUpdateState().status);
  }

  get pwaUpdateMessage(): string {
    const state = this.pwaUpdateState();
    switch (state.status) {
      case 'ready':
        return this.confirmPendingUpdate()
          ? 'Existem registros aguardando sincronização. Eles serão preservados após a atualização.'
          : 'Uma nova versão está pronta. Atualize quando terminar a captura atual.';
      case 'install-failed':
        return state.message;
      case 'unrecoverable':
        return state.message;
      default:
        return '';
    }
  }

  get canRequestPwaReload(): boolean {
    return ['ready', 'unrecoverable'].includes(this.pwaUpdateState().status);
  }

  async applyPwaUpdate(): Promise<void> {
    const result = await this.pwaUpdate.reloadWhenSafe(this.confirmPendingUpdate());
    switch (result) {
      case 'capture-active':
        this.pwaUpdateFeedback.set('Conclua ou descarte a captura atual antes de atualizar.');
        break;
      case 'pending-outbox':
        this.confirmPendingUpdate.set(true);
        this.pwaUpdateFeedback.set(
          'Confirme novamente para atualizar mantendo os registros pendentes no dispositivo.',
        );
        break;
      case 'storage-unavailable':
        this.pwaUpdateFeedback.set(
          'Não foi possível verificar os registros locais. A atualização foi bloqueada por segurança.',
        );
        break;
      case 'not-ready':
        this.pwaUpdateFeedback.set('A atualização ainda não está pronta para aplicação.');
        break;
    }
  }

  get toolbarTitle(): string {
    const path = this.primaryPath;
    if (path === '/' || path === '/menu') {
      return HOME_MENU.label;
    }

    return APP_MODULE_NAVIGATION.find(
      item => path === item.route || path.startsWith(`${item.route}/`),
    )?.label ?? APP_NAME;
  }

  get sessionIdentity(): string {
    const user = this.authSession.currentUser;
    return user ? `${APP_NAME} — ${user.login}` : APP_NAME;
  }

  get showSideMenu(): boolean {
    const path = this.primaryPath;
    return this.isAuthenticated && path !== '/' && path !== '/menu' && path !== '/login';
  }

  private get primaryPath(): string {
    const primaryRoute = this.router.parseUrl(this.router.url).root.children[PRIMARY_OUTLET];
    return `/${primaryRoute?.segments.map(segment => segment.path).join('/') ?? ''}`;
  }

  logout(): void {
    this.authSession.logout();
    // The session$ subscription drives the redirect to /login automatically;
    // no explicit navigation here keeps logout behavior consistent with
    // other call sites (e.g. LoginPage.logout()).
  }
}
