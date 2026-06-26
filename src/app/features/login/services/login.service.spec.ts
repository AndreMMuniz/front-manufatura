import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { LoginError, LoginService } from './login.service';

describe('LoginService', () => {
  let service: LoginService;
  let authSession: AuthSessionService;

  beforeEach(() => {
    authSession = {
      startSession: vi.fn(),
      logout: vi.fn(),
      currentUser: null,
      token: null,
    } as unknown as AuthSessionService;

    TestBed.configureTestingModule({
      providers: [
        LoginService,
        { provide: AuthSessionService, useValue: authSession },
      ],
    });

    service = TestBed.inject(LoginService);
  });

  it('authenticates valid mock credentials and starts an in-memory session', async () => {
    const result = await firstValueFrom(service.login(' operador ', ' mock123 '));

    expect(result).toEqual({
      token: 'mock-datasul-token',
      usuario: {
        id: 'USR-001',
        nome: 'Operador Cortag',
        login: 'operador',
        permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
      },
    });
    expect(authSession.startSession).toHaveBeenCalledWith(result.usuario, result.token);
  });

  it('rejects invalid credentials without starting a session', async () => {
    await expect(firstValueFrom(service.login('operador', 'errada'))).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
    expect(authSession.startSession).not.toHaveBeenCalled();
  });

  it('rejects empty credentials without starting a session', async () => {
    await expect(firstValueFrom(service.login('', 'mock123'))).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
    expect(authSession.startSession).not.toHaveBeenCalled();
  });

  it('delegates logout to the auth session', () => {
    service.logout();

    expect(authSession.logout).toHaveBeenCalled();
  });
});
