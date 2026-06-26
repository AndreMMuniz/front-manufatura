import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, mergeMap, of, tap, throwError, timer } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { LoginRequestDTO, LoginResponseDTO } from '../interfaces/login.dto';
import { mapLoginResponse } from '../mappers/login.mapper';
import { LoginAutenticado, Usuario } from '../models/usuario';

export type LoginErrorCode = 'invalid-credentials' | 'communication' | 'unexpected';

export class LoginError extends Error {
  constructor(readonly code: LoginErrorCode) {
    super(code);
  }
}

@Injectable({ providedIn: 'root' })
export class LoginService {
  private static readonly mockLogin = 'operador';
  private static readonly mockSenha = 'mock123';
  private static readonly mockDelayMs = 300;

  private readonly authSession = inject(AuthSessionService);

  login(login: string, senha: string): Observable<LoginAutenticado> {
    const request: LoginRequestDTO = {
      login: login.trim(),
      senha: senha.trim(),
    };

    if (!request.login || !request.senha) {
      return throwError(() => new LoginError('invalid-credentials'));
    }

    if (request.login !== LoginService.mockLogin || request.senha !== LoginService.mockSenha) {
      return timer(LoginService.mockDelayMs).pipe(
        mergeMap(() => throwError(() => new LoginError('invalid-credentials'))),
      );
    }

    return of(this.buildMockResponse(request)).pipe(
      delay(LoginService.mockDelayMs),
      map(response => mapLoginResponse(response)),
      tap(result => this.authSession.startSession(result.usuario, result.token)),
    );
  }

  logout(): void {
    this.authSession.logout();
  }

  usuarioLogado(): Usuario | null {
    return this.authSession.currentUser;
  }

  token(): string | null {
    return this.authSession.token;
  }

  private buildMockResponse(request: LoginRequestDTO): LoginResponseDTO {
    return {
      token: 'mock-datasul-token',
      usuario: {
        id: 'USR-001',
        nome: 'Operador Cortag',
        login: request.login,
        permissoes: ['MENU_PRINCIPAL', 'PLANO_CONTROLE_CQ'],
      },
    };
  }
}
