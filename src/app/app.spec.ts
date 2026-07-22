import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { PoPageModule, PoToolbarModule } from '@po-ui/ng-components';

import { App } from './app';
import { routes } from './app.routes';
import { AuthSessionService } from './core/auth/auth-session.service';
import { User } from './core/auth/auth.models';
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

describe('App', () => {
  let authSessionMock: AuthSessionService;
  let currentUserValue: User | null;
  let sessionSubject: BehaviorSubject<unknown>;

  beforeEach(async () => {
    currentUserValue = null;

    sessionSubject = new BehaviorSubject<unknown>(null);

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
      providers: [provideRouter(routes), { provide: AuthSessionService, useValue: authSessionMock }],
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
      currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: [] };
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

    it('should route scrap-rework to the operation page in scrap entry mode', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/scrap-rework', ReportOperacaoPage);

      expect(component).toBeInstanceOf(ReportOperacaoPage);
      expect(component.pageTitle).toBe('Refugo / Retrabalho');
      expect(component.feedback).toBe('Informe Ordem e OP. Ao iniciar a operação, o painel de Refugo será aberto.');
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
  });

  it('should render the authenticated toolbar without a side menu', () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: [] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.toolbarTitle).toBe('Plano de Controle CQ - operador');
    expect(fixture.nativeElement.querySelector('po-toolbar')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('po-menu')).toBeNull();
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
  });

  it('should redirect to login when the shell logout clears the session', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: [] };
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
    currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: [] };
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
