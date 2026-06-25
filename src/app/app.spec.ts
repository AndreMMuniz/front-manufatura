import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { PoMenuModule, PoPageModule, PoToolbarModule } from '@po-ui/ng-components';

import { App } from './app';
import { routes } from './app.routes';
import { AuthSessionService } from './core/auth/auth-session.service';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { MainMenuPage } from './features/shop-floor/pages/main-menu/main-menu';
import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';

describe('App', () => {
  let authSessionMock: AuthSessionService;
  let currentUserValue: { username: string } | null;

  beforeEach(async () => {
    currentUserValue = null;

    const sessionSubject = new BehaviorSubject<unknown>(null);

    authSessionMock = {
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      get currentUser() {
        return currentUserValue;
      },
      sessionSubject,
      // Real BehaviorSubject-backed observable so App.constructor can pipe it;
      // tests can drive emissions via `authSessionMock.sessionSubject.next(...)` if needed.
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
      currentUserValue = { username: 'operador' };
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

  it('should keep the menu entry navigating to quality-control', async () => {
    vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(false);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    app.menus[0].action?.(app.menus[0]);

    expect(app.menus[0].label).toBe('Plano Controle CQ');
    expect(navigateSpy).toHaveBeenCalledWith(['/quality-control']);
  });

});