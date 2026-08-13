import { By } from '@angular/platform-browser';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';

import { PoPageModule, PoToolbarComponent, PoToolbarModule } from '@po-ui/ng-components';

import { App } from './app';
import { routes } from './app.routes';
import { AuthSessionService } from './core/auth/auth-session.service';
import { User } from './core/auth/auth.models';
import { APP_MODULE_NAVIGATION } from './core/navigation/app-navigation';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { EquipesPage } from './features/equipes/pages/equipes-page/equipes-page';
import { WorkCenterPage } from './features/shop-floor/pages/work-center/work-center';
import { OperatorsPage } from './features/shop-floor/pages/operators/operators';
import { SfcPlaceholderPage } from './features/shop-floor/pages/sfc-placeholder/sfc-placeholder';
import { MainMenuPage } from './features/shop-floor/pages/main-menu/main-menu';
import { QualityControlWorkspacePage } from './features/quality-control/pages/quality-control-workspace/quality-control-workspace';
import { ReportOperacaoPage } from './features/report-operacao/pages/report-operacao-page/report-operacao-page';
import { ReportaBateladaPage } from './features/reporta-batelada/pages/reporta-batelada-page/reporta-batelada-page';
import { ReporteParadasPage } from './features/reporte-paradas/pages/reporte-paradas-page/reporte-paradas-page';
import { ConnectivityService } from './core/offline/services/connectivity.service';
import { PwaUpdateService, PwaUpdateState } from './core/offline/pwa/pwa-update.service';
import { SynchronizationCenterPage } from './features/synchronization/pages/synchronization-center/synchronization-center';
import { AuthenticatedApiService } from './core/http/authenticated-api.service';

const ALL_MODULE_PERMISSIONS = APP_MODULE_NAVIGATION.map(item => item.permission);

describe('App', () => {
  let authSessionMock: AuthSessionService;
  let currentUserValue: User | null;
  let sessionSubject: BehaviorSubject<unknown>;
  let connectivitySubject: BehaviorSubject<boolean>;
  let pwaState: WritableSignal<PwaUpdateState>;
  let reloadWhenSafe: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    currentUserValue = null;

    sessionSubject = new BehaviorSubject<unknown>(null);
    connectivitySubject = new BehaviorSubject<boolean>(true);
    pwaState = signal<PwaUpdateState>({ status: 'disabled' });
    reloadWhenSafe = vi.fn().mockResolvedValue('reloaded');

    authSessionMock = {
      logout: vi.fn(() => sessionSubject.next(null)),
      isAuthenticated: vi.fn().mockReturnValue(false),
      get currentUser() {
        return currentUserValue;
      },
      // Real BehaviorSubject-backed observable so App.constructor can pipe it;
      // tests can drive emissions through the local `sessionSubject`.
      session$: sessionSubject.asObservable(),
    } as unknown as AuthSessionService;

    await TestBed.configureTestingModule({
      imports: [PoToolbarModule, PoPageModule, App],
      providers: [
        provideRouter(routes),
        { provide: AuthSessionService, useValue: authSessionMock },
        {
          provide: AuthenticatedApiService,
          useValue: {
            get: vi.fn((url: string) => {
              if (url === '/api/production-areas') {
                return of([{ code: '4001', description: 'Produção' }]);
              }
              if (url === '/api/work-centers') {
                return of([{
                  code: 'CT-EXT-01', description: 'Extrusão', areaCode: '4001',
                  area: 'Produção', machineGroup: 'Extrusoras', establishment: '101', active: true,
                }]);
              }
              if (url === '/api/operators') {
                return of([{ code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true }]);
              }
              if (url === '/api/operational-responsibles') {
                return of([{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }]);
              }
              return of([]);
            }),
          },
        },
        {
          provide: PwaUpdateService,
          useValue: { state: pwaState.asReadonly(), reloadWhenSafe },
        },
        {
          provide: ConnectivityService,
          useValue: {
            isBrowser: true,
            onlineHint: true,
            changes$: connectivitySubject.asObservable(),
          },
        },
      ],
    }).compileComponents();
  });

  function returnUrlFrom(router: Router): string | null {
    const tree = router.parseUrl(router.url);
    return tree.queryParams['returnUrl'] ?? null;
  }

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  describe('when authenticated', () => {
    beforeEach(() => {
      vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
      currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: ALL_MODULE_PERMISSIONS };
    });

    it('should route quality-control to the unified workspace', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/quality-control', QualityControlWorkspacePage);

      expect(component).toBeInstanceOf(QualityControlWorkspacePage);
      expect(TestBed.inject(Router).url).toBe('/quality-control');
    });

    it('should route menu to the authenticated main menu page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/menu', MainMenuPage);

      expect(component).toBeInstanceOf(MainMenuPage);
      expect(TestBed.inject(Router).url).toBe('/menu');
    });

    it('should return direct inspection access to route generation when no route was generated', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/quality-control/inspection', QualityControlWorkspacePage);

      expect(component).toBeInstanceOf(QualityControlWorkspacePage);
      expect(TestBed.inject(Router).url).toBe('/quality-control');
    });

    it('should return direct exam entry access to route generation when no exam was selected', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/quality-control/exam-entry', QualityControlWorkspacePage);

      expect(component).toBeInstanceOf(QualityControlWorkspacePage);
      expect(TestBed.inject(Router).url).toBe('/quality-control');
    });

    it('should route work-center to the work center page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/work-center', WorkCenterPage);

      expect(component).toBeInstanceOf(WorkCenterPage);
      expect(TestBed.inject(Router).url).toBe('/work-center');
    });

    it('should route operators to the operator selection page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/operators', OperatorsPage);

      expect(component).toBeInstanceOf(OperatorsPage);
      expect(TestBed.inject(Router).url).toBe('/operators');
    });

    it('should route teams to the teams page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/teams', EquipesPage);

      expect(component).toBeInstanceOf(EquipesPage);
      expect(TestBed.inject(Router).url).toBe('/teams');
    });

    it('should route operation-reporting to the report operation page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/operation-reporting', ReportOperacaoPage);

      expect(component).toBeInstanceOf(ReportOperacaoPage);
      expect(TestBed.inject(Router).url).toBe('/operation-reporting');
    });

    it('should route batch-reporting to the batch report page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/batch-reporting', ReportaBateladaPage);

      expect(component).toBeInstanceOf(ReportaBateladaPage);
      expect(TestBed.inject(Router).url).toBe('/batch-reporting');
    });

    it('should route stoppages to the stoppage reporting page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/stoppages', ReporteParadasPage);

      expect(component).toBeInstanceOf(ReporteParadasPage);
      expect(TestBed.inject(Router).url).toBe('/stoppages');
    });

    it('carrega a Central por rota lazy protegida sem adicioná-la aos módulos', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl(
        '/synchronization',
        SynchronizationCenterPage,
      );

      expect(component).toBeInstanceOf(SynchronizationCenterPage);
      expect(APP_MODULE_NAVIGATION.some(item => item.route === '/synchronization')).toBe(false);
    });

    it('should route scrap-rework to the operation page in scrap entry mode', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/scrap-rework', ReportOperacaoPage);

      expect(component).toBeInstanceOf(ReportOperacaoPage);
      expect(component.pageTitle).toBe('Refugo / Retrabalho');
      expect(component.feedback).toBe('Selecione a Área de Produção e o Centro de Trabalho para consultar as ordens.');
      expect(TestBed.inject(Router).url).toBe('/scrap-rework');
    });

    it('should route item-consultation to the SFC placeholder page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/item-consultation', SfcPlaceholderPage);

      expect(component).toBeInstanceOf(SfcPlaceholderPage);
      expect(component.title).toBe('Consulta Item');
      expect(TestBed.inject(Router).url).toBe('/item-consultation');
    });

    it('should route login to the login page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/login', LoginPage);

      expect(component).toBeInstanceOf(LoginPage);
      expect(TestBed.inject(Router).url).toBe('/login');
    });

    it('should redirect root to /menu, but keep unknown deep links in place when authenticated', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/');
      expect(router.url).toBe('/menu');

      await harness.navigateByUrl('/orders/42');
      expect(router.url).toBe('/orders/42');
    });
  });

  describe('when not authenticated', () => {
    beforeEach(() => {
      vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(false);
      currentUserValue = null;
    });

    it('should redirect quality-control to login with returnUrl=quality-control', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/quality-control');

      expect(router.url.startsWith('/login')).toBe(true);
      expect(returnUrlFrom(router)).toBe('/quality-control');
    });

    it.each(['/quality-control/inspection', '/quality-control/exam-entry'])(
      'should protect legacy CQ redirect %s through the effective workspace target',
      async url => {
        const harness = await RouterTestingHarness.create();
        const router = TestBed.inject(Router);

        await harness.navigateByUrl(url);

        expect(router.url.startsWith('/login')).toBe(true);
        expect(returnUrlFrom(router)).toBe('/quality-control');
      },
    );

    it('should protect the main menu with returnUrl=/menu when not authenticated', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/menu');

      expect(router.url.startsWith('/login')).toBe(true);
      expect(returnUrlFrom(router)).toBe('/menu');
    });

    it('should redirect work-center to login with returnUrl=/work-center when not authenticated', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/work-center');

      expect(router.url.startsWith('/login')).toBe(true);
      expect(returnUrlFrom(router)).toBe('/work-center');
    });

    it('should redirect operators to login with returnUrl=/operators when not authenticated', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/operators');

      expect(router.url.startsWith('/login')).toBe(true);
      expect(returnUrlFrom(router)).toBe('/operators');
    });

    it.each(['/teams', '/operation-reporting', '/batch-reporting', '/stoppages', '/scrap-rework', '/item-consultation'])(
      'should redirect %s to login with the exact returnUrl when not authenticated',
      async url => {
        const harness = await RouterTestingHarness.create();
        const router = TestBed.inject(Router);

        await harness.navigateByUrl(url);

        expect(router.url.startsWith('/login')).toBe(true);
        expect(returnUrlFrom(router)).toBe(url);
      },
    );

    it('protege a Central preservando returnUrl=/synchronization', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/synchronization');

      expect(router.url.startsWith('/login')).toBe(true);
      expect(returnUrlFrom(router)).toBe('/synchronization');
    });

    it('should keep login accessible', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/login', LoginPage);

      expect(component).toBeInstanceOf(LoginPage);
      expect(TestBed.inject(Router).url).toBe('/login');
    });

    it('should redirect root to login with returnUrl=/menu via default redirect', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/');

      expect(router.url.startsWith('/login')).toBe(true);
      expect(returnUrlFrom(router)).toBe('/menu');
    });

    it('should preserve deep-link returnUrl through the auth round trip when hitting unknown routes', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/orders/42');

      expect(router.url.startsWith('/login')).toBe(true);
      expect(returnUrlFrom(router)).toBe('/orders/42');
    });
  });

  it('should not render authenticated shell navigation when anonymous', () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(false);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('po-toolbar')).toBeNull();
    expect(fixture.nativeElement.querySelector('po-menu')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="synchronization-indicator"]'))
      .toBeNull();
  });

  it('exibe banner offline acessível sem bloquear o conteúdo', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    connectivitySubject.next(false);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('[data-testid="offline-banner"]');
    expect(banner).not.toBeNull();
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.textContent).toContain('Você está offline');
    expect(fixture.nativeElement.querySelector('[data-testid="app-content"]')).not.toBeNull();
  });

  it('comunica update pronto e exige confirmação para Outbox pendente', async () => {
    reloadWhenSafe
      .mockResolvedValueOnce('pending-outbox')
      .mockResolvedValueOnce('reloaded');
    pwaState.set({
      status: 'ready',
      currentVersionHash: 'v1',
      versionHash: 'v2',
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector('[data-testid="pwa-update-notice"]');
    expect(notice.textContent).toContain('Uma nova versão está pronta');

    notice.querySelector('button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="pwa-update-feedback"]').textContent)
      .toContain('Confirme novamente');

    fixture.nativeElement.querySelector('[data-testid="pwa-update-notice"] button').click();
    await fixture.whenStable();
    expect(reloadWhenSafe).toHaveBeenNthCalledWith(1, false);
    expect(reloadWhenSafe).toHaveBeenNthCalledWith(2, true);
  });

  it('should render the app name in the authenticated Home toolbar without a side menu', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: ALL_MODULE_PERMISSIONS };
    await TestBed.inject(Router).navigateByUrl('/menu');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const toolbar = fixture.debugElement.query(By.directive(PoToolbarComponent))
      .componentInstance as PoToolbarComponent;

    expect(app.toolbarTitle).toBe('Apontamento Manufatura - operador');
    expect(toolbar.title).toBe('Apontamento Manufatura - operador');
    expect(fixture.nativeElement.querySelector('po-toolbar')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('po-menu')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="synchronization-indicator"]'))
      .not.toBeNull();
  });

  it('should keep the side menu hidden during the root redirect and with Home matrix parameters', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(TestBed.inject(Router).url).toBe('/');
    expect(app.showSideMenu).toBe(false);
    expect(fixture.nativeElement.querySelector('po-menu')).toBeNull();

    await TestBed.inject(Router).navigateByUrl('/menu;origin=toolbar');
    fixture.detectChanges();

    expect(app.showSideMenu).toBe(false);
    expect(fixture.nativeElement.querySelector('po-menu')).toBeNull();
  });

  it('should render contextual navigation on module routes with Home first and shared modules in order', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: ALL_MODULE_PERMISSIONS };
    await TestBed.inject(Router).navigateByUrl('/quality-control');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.showSideMenu).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="app-side-menu"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('po-menu')).not.toBeNull();
    expect(app.menus[0]).toMatchObject({
      label: 'Menu Principal',
      shortLabel: 'Home',
      icon: 'an an-house-line',
      link: '/menu',
    });
    expect(app.menus.slice(1).map(({ label, shortLabel, icon, link }) => ({
      label,
      shortLabel,
      icon,
      route: link,
    }))).toEqual(APP_MODULE_NAVIGATION.map(({ label, shortLabel, icon, route }) => ({
      label,
      shortLabel,
      icon,
      route,
    })));
    expect(app.menus.some(item => item.label === 'Sair')).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="main-menu-return"]')).toBeNull();
  });

  it('should expose Sair as the only toolbar action using the installed PO-UI API', () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.toolbarActions).toHaveLength(1);
    expect(app.toolbarActions[0]).toMatchObject({
      label: 'Sair',
      icon: 'an an-sign-out',
      type: 'danger',
    });
    expect(fixture.nativeElement.querySelector('po-toolbar-actions')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Abrir ações da sessão"]'),
    ).not.toBeNull();
  });

  it('should redirect to login when the shell logout clears the session', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: ALL_MODULE_PERMISSIONS };
    sessionSubject.next({ user: currentUserValue, token: 'token-123', authenticatedAt: new Date() });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    app.toolbarActions[0].action?.();
    await Promise.resolve();

    expect(authSessionMock.logout).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('should keep login visible when login-page logout clears the session while already on login', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: ALL_MODULE_PERMISSIONS };
    sessionSubject.next({ user: currentUserValue, token: 'token-123', authenticatedAt: new Date() });
    const appFixture = TestBed.createComponent(App);
    appFixture.detectChanges();
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const login = await harness.navigateByUrl('/login', LoginPage);
    login.logout();
    await Promise.resolve();

    expect(authSessionMock.logout).toHaveBeenCalled();
    expect(router.url).toBe('/login');
    expect(navigateSpy).not.toHaveBeenCalledWith(['/login']);
  });

});
