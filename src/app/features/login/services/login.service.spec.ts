import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { LoginError, LoginService } from './login.service';

describe('LoginService', () => {
  let service: LoginService;
  let authSession: AuthSessionService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    authSession = {
      startSession: vi.fn(),
      logout: vi.fn(),
      currentUser: null,
      token: null,
    } as unknown as AuthSessionService;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        LoginService,
        { provide: AuthSessionService, useValue: authSession },
      ],
    });

    service = TestBed.inject(LoginService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('authenticates with the login API and starts an in-memory session', async () => {
    const loginResult = firstValueFrom(service.login(' operador ', ' senha literal '));
    const request = httpTesting.expectOne('/api/auth/login');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ login: 'operador', senha: ' senha literal ' });

    request.flush({
      token: 'external-session-token',
      tokenExpiresAt: '2026-07-29T21:00:00.000Z',
      offlineSessionExpiresAt: '2026-07-29T20:00:00.000Z',
      usuario: {
        id: 'USR-EXTERNAL',
        nome: 'Operador Cortag',
        login: 'operador',
        permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
      },
    });

    const result = await loginResult;

    expect(result).toEqual({
      token: 'external-session-token',
      tokenExpiresAt: '2026-07-29T21:00:00.000Z',
      offlineSessionExpiresAt: '2026-07-29T20:00:00.000Z',
      usuario: {
        id: 'USR-EXTERNAL',
        nome: 'Operador Cortag',
        login: 'operador',
        permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
      },
    });
    expect(authSession.startSession).toHaveBeenCalledTimes(1);
    expect(authSession.startSession).toHaveBeenCalledWith(
      result.usuario,
      result.token,
      { expiresAt: result.tokenExpiresAt },
      { expiresAt: result.offlineSessionExpiresAt },
    );
  });

  it('rejects invalid credentials without starting a session', async () => {
    const loginResult = firstValueFrom(service.login('operador', 'errada'));
    const request = httpTesting.expectOne('/api/auth/login');

    request.flush({ code: 'invalid-credentials' }, { status: 401, statusText: 'Unauthorized' });

    await expect(loginResult).rejects.toMatchObject({
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

  it('aceita senha não vazia composta somente por espaços sem transformá-la', async () => {
    const loginResult = firstValueFrom(service.login(' operador ', '   '));
    const request = httpTesting.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ login: 'operador', senha: '   ' });
    request.flush({ code: 'invalid-credentials' }, { status: 401, statusText: 'Unauthorized' });
    await expect(loginResult).rejects.toMatchObject({ code: 'invalid-credentials' });
  });

  it('mapeia somente 403 access-denied coerente e não inicia sessão', async () => {
    const loginResult = firstValueFrom(service.login('operador', 'literal'));
    const request = httpTesting.expectOne('/api/auth/login');
    request.flush({ code: 'access-denied' }, { status: 403, statusText: 'Forbidden' });

    await expect(loginResult).rejects.toMatchObject({ code: 'access-denied' });
    expect(authSession.startSession).not.toHaveBeenCalled();
  });

  it('não aceita outro código público em resposta 403', async () => {
    const loginResult = firstValueFrom(service.login('operador', 'literal'));
    httpTesting.expectOne('/api/auth/login').flush(
      { code: 'datasul-unavailable' },
      { status: 403, statusText: 'Forbidden' },
    );
    await expect(loginResult).rejects.toMatchObject({ code: 'unexpected' });
    expect(authSession.startSession).not.toHaveBeenCalled();
  });

  it.each([502, 503, 504])('mapeia %i para comunicação sem iniciar sessão', async status => {
    const loginResult = firstValueFrom(service.login('operador', 'literal'));
    const request = httpTesting.expectOne('/api/auth/login');
    request.flush({ code: 'erro-seguro' }, { status, statusText: 'Upstream error' });

    await expect(loginResult).rejects.toMatchObject({ code: 'communication' });
    expect(authSession.startSession).not.toHaveBeenCalled();
  });

  it.each([
    { token: 'token', usuario: { id: 'id', nome: 'Nome', login: 'login', permissoes: [] } },
    { token: 'token', tokenExpiresAt: 'invalida', usuario: { id: 'id', nome: 'Nome', login: 'login', permissoes: [] } },
  ])('não inicia sessão para contrato de sucesso inválido', async response => {
    const loginResult = firstValueFrom(service.login('operador', 'literal'));
    httpTesting.expectOne('/api/auth/login').flush(response);

    await expect(loginResult).rejects.toMatchObject({ code: 'unexpected' });
    expect(authSession.startSession).not.toHaveBeenCalled();
  });

  it('maps server connection failures to a communication error', async () => {
    const loginResult = firstValueFrom(service.login('operador', 'mock123'));
    const request = httpTesting.expectOne('/api/auth/login');

    request.flush(null, { status: 503, statusText: 'Service Unavailable' });

    await expect(loginResult).rejects.toMatchObject({
      code: 'communication',
    });
    expect(authSession.startSession).not.toHaveBeenCalled();
  });

  it('delegates logout to the auth session', () => {
    service.logout();

    expect(authSession.logout).toHaveBeenCalled();
  });
});
