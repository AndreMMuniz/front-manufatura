import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';

import { PoMenuModule, PoPageModule, PoToolbarModule } from '@po-ui/ng-components';

import { App } from './app';
import { routes } from './app.routes';
import { AuthSessionService } from './core/auth/auth-session.service';
import { LoginPage } from './features/login/pages/login-page/login-page';
import { QualityControlHome } from './features/quality-control/pages/quality-control-home/quality-control-home';

describe('App', () => {
  let authSessionMock: AuthSessionService;
  let currentUserValue: { username: string } | null;

  beforeEach(async () => {
    currentUserValue = null;

    authSessionMock = {
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      get currentUser() {
        return currentUserValue;
      },
      session$: { subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) } as never,
    } as unknown as AuthSessionService;

    await TestBed.configureTestingModule({
      imports: [PoToolbarModule, PoMenuModule, PoPageModule, App],
      providers: [provideRouter(routes), { provide: AuthSessionService, useValue: authSessionMock }],
    }).compileComponents();
  });

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

    it('should route login to the login page', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/login', LoginPage);

      expect(component).toBeInstanceOf(LoginPage);
      expect(TestBed.inject(Router).url).toBe('/login');
    });

    it('should redirect root and unknown routes to quality-control', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/');
      expect(router.url).toBe('/quality-control');

      await harness.navigateByUrl('/unknown-route');
      expect(router.url).toBe('/quality-control');
    });
  });

  describe('when not authenticated', () => {
    beforeEach(() => {
      vi.mocked(authSessionMock.isAuthenticated).mockReturnValue(false);
      currentUserValue = null;
    });

    it('should redirect quality-control to login with returnUrl', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/quality-control');

      expect(router.url).toBe('/login?returnUrl=%2Fquality-control');
    });

    it('should keep login accessible', async () => {
      const harness = await RouterTestingHarness.create();

      const component = await harness.navigateByUrl('/login', LoginPage);

      expect(component).toBeInstanceOf(LoginPage);
      expect(TestBed.inject(Router).url).toBe('/login');
    });

    it('should redirect root and unknown routes to login via quality-control', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);

      await harness.navigateByUrl('/');
      expect(router.url).toBe('/login?returnUrl=%2Fquality-control');

      await harness.navigateByUrl('/unknown-route');
      expect(router.url).toBe('/login?returnUrl=%2Fquality-control');
    });
  });

  it('should keep the menu entry navigating to quality-control', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    app.menus[0].action?.(app.menus[0]);

    expect(app.menus[0].label).toBe('Plano Controle CQ');
    expect(navigateSpy).toHaveBeenCalledWith(['/quality-control']);
  });
});
