import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { vi } from 'vitest';

import { PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let component: LoginPage;
  let routerMock: Router;
  let authSessionMock: AuthSessionService;
  let currentReturnUrl: string | undefined;

  function setReturnUrl(returnUrl: string | undefined): void {
    currentReturnUrl = returnUrl;
  }

  beforeEach(async () => {
    routerMock = { navigateByUrl: vi.fn().mockResolvedValue(true) } as unknown as Router;
    currentReturnUrl = undefined;

    const routeMock = {
      get snapshot() {
        return {
          queryParamMap: convertToParamMap(currentReturnUrl === undefined ? {} : { returnUrl: currentReturnUrl }),
        };
      },
    } as unknown as ActivatedRoute;

    authSessionMock = {
      login: vi.fn().mockReturnValue(false),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(false),
      currentUser: null,
    } as unknown as AuthSessionService;

    await TestBed.configureTestingModule({
      imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule, LoginPage],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: ActivatedRoute, useValue: routeMock },
        { provide: AuthSessionService, useValue: authSessionMock },
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
    setReturnUrl('/quality-control');
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();

    expect(authSessionMock.login).toHaveBeenCalledWith('operador', 'mock123');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/quality-control');
  });

  it('falls back to quality-control without returnUrl', () => {
    vi.mocked(authSessionMock.login).mockReturnValue(true);
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/quality-control');
  });

  it.each([
    'https://datasul.example/menu',
    '//datasul.example/menu',
    '/login',
    '/login?returnUrl=/quality-control',
    'menu',
    '/%2F%2Fevil.com',
  ])('rejects unsafe returnUrl %s', returnUrl => {
    vi.mocked(authSessionMock.login).mockReturnValue(true);
    setReturnUrl(returnUrl);
    component.user = 'operador';
    component.password = 'mock123';

    component.submit();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/quality-control');
  });

  it('updates user and password models when typing into the fields', () => {
    const loginInput = fixture.nativeElement.querySelector('po-login input') as HTMLInputElement | null;
    const passwordInput = fixture.nativeElement.querySelector('po-password input') as HTMLInputElement | null;

    if (loginInput) {
      loginInput.value = 'operador';
      loginInput.dispatchEvent(new Event('input'));
    }
    if (passwordInput) {
      passwordInput.value = 'mock123';
      passwordInput.dispatchEvent(new Event('input'));
    }

    fixture.detectChanges();

    expect(component.user).toBe('operador');
    expect(component.password).toBe('mock123');
  });

  it('calls authSession.logout when logout is triggered', () => {
    component.logout();

    expect(authSessionMock.logout).toHaveBeenCalled();
  });
});
