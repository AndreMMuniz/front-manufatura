import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { PoMenuModule, PoPageModule, PoToolbarModule } from '@po-ui/ng-components';

import { App } from './app';
import { routes } from './app.routes';
import { AuthSessionService } from './core/auth/auth-session.service';
import { User } from './core/auth/auth.models';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { MainMenuPage } from './features/shop-floor/pages/main-menu/main-menu';
import { WorkCenterPage } from './features/shop-floor/pages/work-center/work-center';
import { OperatorsPage } from './features/shop-floor/pages/operators/operators';
import { SfcPlaceholderPage } from './features/shop-floor/pages/sfc-placeholder/sfc-placeholder';
import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';

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
      imports: [PoToolbarModule, PoMenuModule, PoPageModule, App],
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

    it('should route quality-control to the quality control home page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/quality-control', QualityControlHome);

      expect(component).toBeInstanceOf(QualityControlHome);
      expect(TestBed.inject(Router).url).toBe('/quality-control');
    });

    it('should route menu to the main menu page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/menu', MainMenuPage);

      expect(component).toBeInstanceOf(MainMenuPage);
      expect(TestBed.inject(Router).url).toBe('/menu');
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

    it.each([
      ['/teams', 'Equipes'],
      ['/operation-reporting', 'Reporte de Operações'],
      ['/stoppages', 'Paradas'],
      ['/scrap-rework', 'Refugo / Retrabalho'],
      ['/item-consultation', 'Consulta Item'],
    ])('should route %s to the SFC placeholder page', async (url, title) => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl(url, SfcPlaceholderPage);

      expect(component).toBeInstanceOf(SfcPlaceholderPage);
      expect(component.title).toBe(title);
      expect(TestBed.inject(Router).url).toBe(url);
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

    it('should redirect menu to login with returnUrl=/menu when not authenticated', async () => {
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

    it.each(['/teams', '/operation-reporting', '/stoppages', '/scrap-rework', '/item-consultation'])(
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

    it('should redirect root to login with returnUrl=/menu via /menu redirect', async () => {
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

  it('should not expose shell navigation when anonymous', () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(false);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.menus).toEqual([]);
  });

  it('should show shell navigation with logout when authenticated', () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
      currentUserValue = { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: [] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.toolbarTitle).toBe('Plano de Controle CQ - operador');
    expect(app.menus.map(item => item.label)).toEqual([
      'Menu Principal',
      'Plano Controle CQ',
      'Ordens e Reportes',
      'Paradas',
      'Refugo / Retrabalho',
      'Consulta Item',
      'Centro de Trabalho',
      'Operador',
      'Equipes',
      'Sair',
    ]);
  });

  it('should expose a direct lateral navigation item for every implemented SFC destination', () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const menuLabels = app.menus.map(item => item.label);

    expect(menuLabels).toContain('Ordens e Reportes');
    expect(menuLabels).toContain('Paradas');
    expect(menuLabels).toContain('Refugo / Retrabalho');
    expect(menuLabels).toContain('Consulta Item');
    expect(menuLabels).toContain('Centro de Trabalho');
    expect(menuLabels).toContain('Operador');
    expect(menuLabels).toContain('Equipes');
  });

  it('should use PO-UI icon-capable menu items so the side menu can collapse cleanly', () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    for (const item of app.menus) {
      expect(item.icon).toBeTruthy();
      expect(item.shortLabel).toBeTruthy();
    }
  });

  it('should expose main menu as a direct shell menu link', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.menus[0].label).toBe('Menu Principal');
    expect(app.menus[0].link).toBe('/menu');
  });

  it('should keep the shell menu entry linking to quality-control', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(true);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;

    expect(app.menus[1].label).toBe('Plano Controle CQ');
    expect(app.menus[1].link).toBe('/quality-control');
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

    app.logout();
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
