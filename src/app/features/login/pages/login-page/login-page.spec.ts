import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { PoButtonModule, PoFieldModule, PoLoadingModule } from '@po-ui/ng-components';

import { LoginAutenticado, Usuario } from '../../models/usuario';
import { LoginError, LoginService } from '../../services/login.service';
import { LoginPage } from './login-page';

const USUARIO: Usuario = {
  id: 'USR-001',
  nome: 'Operador Cortag',
  login: 'operador',
  permissoes: ['MENU_PRINCIPAL'],
};

const LOGIN_RESULT: LoginAutenticado = {
  token: 'token-123',
  usuario: USUARIO,
};

function buildLoginServiceMock(authenticated: boolean): LoginService {
  return {
    login: vi.fn((): Observable<LoginAutenticado> => throwError(() => new LoginError('invalid-credentials'))),
    logout: vi.fn(),
    usuarioLogado: vi.fn().mockReturnValue(authenticated ? USUARIO : null),
    token: vi.fn().mockReturnValue(authenticated ? 'token-123' : null),
  } as unknown as LoginService;
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
  let loginServiceMock: LoginService;
  let setReturnUrl: (v: string | undefined) => void;

  beforeEach(async () => {
    routerMock = { navigateByUrl: vi.fn().mockResolvedValue(true) } as unknown as Router;
    loginServiceMock = buildLoginServiceMock(false);
    const route = buildRouteMock();
    setReturnUrl = route.setReturnUrl;

    await TestBed.configureTestingModule({
      imports: [FormsModule, PoButtonModule, PoFieldModule, PoLoadingModule, LoginPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: route.routeMock },
        { provide: LoginService, useValue: loginServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps login blocked while required fields are missing', () => {
    component.entrar();

    expect(component.submitted).toBe(true);
    expect(component.feedback).toBe(component.emptyFieldsMessage);
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    expect(loginServiceMock.login).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials with generic feedback and clears only the password', () => {
    component.login = 'operador';
    component.senha = 'errada';

    component.entrar();

    expect(component.login).toBe('operador');
    expect(component.senha).toBe('');
    expect(component.feedback).toBe('Usuário ou senha inválidos.');
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('navigates to a safe internal returnUrl after valid credentials', () => {
    vi.mocked(loginServiceMock.login).mockReturnValue(of(LOGIN_RESULT));
    setReturnUrl('/quality-control');
    component.login = 'operador';
    component.senha = 'mock123';

    component.entrar();

    expect(loginServiceMock.login).toHaveBeenCalledWith('operador', 'mock123');
    expect(component.senha).toBe('');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/quality-control');
  });

  it('decodes encoded returnUrl before navigating', () => {
    vi.mocked(loginServiceMock.login).mockReturnValue(of(LOGIN_RESULT));
    setReturnUrl('/quality-control%2Freports');
    component.login = 'operador';
    component.senha = 'mock123';

    component.entrar();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/quality-control/reports');
  });

  it('falls back to /menu without returnUrl', () => {
    vi.mocked(loginServiceMock.login).mockReturnValue(of(LOGIN_RESULT));
    component.login = 'operador';
    component.senha = 'mock123';

    component.entrar();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/menu');
  });

  it.each([
    'https://datasul.example/quality-control',
    '//datasul.example/quality-control',
    '/login',
    '/Login',
    '/login?returnUrl=/quality-control',
    'quality-control',
    '/%2F%2Fevil.com',
    '/%252F%252Fevil.com',
    '/login/foo',
  ])('rejects unsafe returnUrl %s', returnUrl => {
    vi.mocked(loginServiceMock.login).mockReturnValue(of(LOGIN_RESULT));
    setReturnUrl(returnUrl);
    component.login = 'operador';
    component.senha = 'mock123';

    component.entrar();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/menu');
  });

  it('resets submitting when navigation is rejected', async () => {
    vi.mocked(loginServiceMock.login).mockReturnValue(of(LOGIN_RESULT));
    vi.mocked(routerMock.navigateByUrl).mockRejectedValueOnce(new Error('cancel'));
    component.login = 'operador';
    component.senha = 'mock123';

    component.entrar();
    await Promise.resolve();

    expect(component.submitting).toBe(false);
  });

  it('does not invoke router.navigateByUrl when fields are empty', () => {
    component.login = '';
    component.senha = '';

    component.entrar();

    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('calls loginService.logout when logout is triggered', () => {
    component.logout();

    expect(loginServiceMock.logout).toHaveBeenCalled();
  });

  describe('when already authenticated', () => {
    beforeEach(async () => {
      TestBed.resetTestingModule();
      routerMock = { navigateByUrl: vi.fn().mockResolvedValue(true) } as unknown as Router;
      loginServiceMock = buildLoginServiceMock(true);
      const route = buildRouteMock();

      await TestBed.configureTestingModule({
        imports: [FormsModule, PoButtonModule, PoFieldModule, PoLoadingModule, LoginPage],
        providers: [
          { provide: Router, useValue: routerMock },
          { provide: ActivatedRoute, useValue: route.routeMock },
          { provide: LoginService, useValue: loginServiceMock },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(LoginPage);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('renders the authenticated view with a logout button', () => {
      const buttons = Array.from(fixture.nativeElement.querySelectorAll('po-button')) as Array<HTMLElement>;
      const hasLogout = buttons.some(b => b.textContent?.includes('Sair'));

      expect(component.isAuthenticated).toBe(true);
      expect(hasLogout).toBe(true);
    });
  });
});
