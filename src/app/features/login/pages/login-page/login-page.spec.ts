import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { vi } from 'vitest';

import { PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { LoginPage } from './login-page';

function buildAuthSessionMock(authenticated: boolean): AuthSessionService {
  return {
    login: vi.fn().mockReturnValue(false),
    logout: vi.fn(),
    isAuthenticated: vi.fn().mockReturnValue(authenticated),
    currentUser: authenticated ? { username: 'operador' } : null,
  } as unknown as AuthSessionService;
}

function buildRouteMock(): { routeMock: ActivatedRoute; setReturnUrl: (v: string | undefined) => void } {
  let current: string | undefined;
  const routeMock = {
    get snapshot() {
      return {
        queryParamMap: convertToParamMap(current === undefined ? {} : { returnUrl: current }),
      };
    },
  } as unknown as ActivatedRoute;
  return { routeMock, setReturnUrl: v => (current = v) };
}

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let component: LoginPage;
  let routerMock: Router;
  let authSessionMock: AuthSessionService;
  let setReturnUrl: (v: string | undefined) => void;

  beforeEach(async () => {
    routerMock = { navigateByUrl: vi.fn().mockResolvedValue(true) } as unknown as Router;
    authSessionMock = buildAuthSessionMock(false);
    const route = buildRouteMock();
    setReturnUrl = route.setReturnUrl;

    await TestBed.configureTestingModule({
      imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule, LoginPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: route.routeMock },
        { provide: AuthSessionService, useValue: authSessionMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps login blocked while required fields are missing', () => {
    component.submit();

    expect(component.submitted).toBe(true);
    expect(component.feedback).toBe(component.emptyFieldsMessage);
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('rejects invalid mock credentials with generic feedback and clears only the password', () => {
    component.user = 'operador';
    component.password = 'errada';

    component.submit();

    expect(component.user).toBe('operador');
    expect(component.password).toBe('');
    expect(component.feedback).toBe('Usuario ou senha invalidos.');
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('navigates to a safe internal returnUrl after valid mock credentials', () => {
    vi.mocked(authSessionMock.login).mockReturnValue(true);
    setReturnUrl('/menu');
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();

    expect(authSessionMock.login).toHaveBeenCalledWith('operador', 'mock123');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/menu');
  });

  it('decodes encoded returnUrl before navigating', () => {
    vi.mocked(authSessionMock.login).mockReturnValue(true);
    setReturnUrl('/menu%2Freports');
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/menu/reports');
  });

  it('falls back to /menu without returnUrl', () => {
    vi.mocked(authSessionMock.login).mockReturnValue(true);
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/menu');
  });

  it.each([
    'https://datasul.example/menu',
    '//datasul.example/menu',
    '/login',
    '/Login',
    '/login?returnUrl=/quality-control',
    'menu',
    '/%2F%2Fevil.com',
    '/%252F%252Fevil.com',
    '/login/foo',
  ])('rejects unsafe returnUrl %s', returnUrl => {
    vi.mocked(authSessionMock.login).mockReturnValue(true);
    setReturnUrl(returnUrl);
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/menu');
  });

  it('resets submitting when navigation is rejected', async () => {
    vi.mocked(authSessionMock.login).mockReturnValue(true);
    vi.mocked(routerMock.navigateByUrl).mockRejectedValueOnce(new Error('cancel'));
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();
    await Promise.resolve();

    expect(component.submitting).toBe(false);
  });

  it('does not invoke router.navigateByUrl when fields are empty', () => {
    component.user = '';
    component.password = '';

    component.submit();

    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('calls authSession.logout when logout is triggered', () => {
    component.logout();

    expect(authSessionMock.logout).toHaveBeenCalled();
  });

  describe('when already authenticated', () => {
    beforeEach(async () => {
      routerMock = { navigateByUrl: vi.fn().mockResolvedValue(true) } as unknown as Router;
      authSessionMock = buildAuthSessionMock(true);
      const route = buildRouteMock();

      await TestBed.configureTestingModule({
        imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule, LoginPage],
        providers: [
          { provide: Router, useValue: routerMock },
          { provide: ActivatedRoute, useValue: route.routeMock },
          { provide: AuthSessionService, useValue: authSessionMock },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(LoginPage);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('renders the authenticated view with a logout button', () => {
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('po-button'),
      ) as Array<HTMLElement>;
      const hasLogout = buttons.some(b => b.textContent?.includes('Sair da sessão mock'));

      expect(component.isAuthenticated).toBe(true);
      expect(hasLogout).toBe(true);
    });
  });
});
