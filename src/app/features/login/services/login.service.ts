import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, tap, throwError } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { LoginRequestDTO, LoginResponseDTO } from '../interfaces/login.dto';
import { mapLoginResponse } from '../mappers/login.mapper';
import { LoginAutenticado, Usuario } from '../models/usuario';

export type LoginErrorCode =
  | 'invalid-credentials'
  | 'access-denied'
  | 'communication'
  | 'unexpected';

export class LoginError extends Error {
  constructor(readonly code: LoginErrorCode) {
    super(code);
  }
}

@Injectable({ providedIn: 'root' })
export class LoginService {
  private readonly http = inject(HttpClient);
  private readonly authSession = inject(AuthSessionService);

  login(login: string, senha: string): Observable<LoginAutenticado> {
    const request: LoginRequestDTO = {
      login: login.trim(),
      senha,
    };

    if (!request.login || !request.senha.length) {
      return throwError(() => new LoginError('invalid-credentials'));
    }

    return this.http.post<LoginResponseDTO>('/api/auth/login', request).pipe(
      map(response => mapLoginResponse(response)),
      tap(result => this.authSession.startSession(
        result.usuario,
        result.token,
        { expiresAt: result.tokenExpiresAt },
        result.offlineSessionExpiresAt
          ? { expiresAt: result.offlineSessionExpiresAt }
          : undefined,
      )),
      catchError(error => throwError(() => new LoginError(this.mapLoginError(error)))),
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

  private mapLoginError(error: unknown): LoginErrorCode {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 400 || error.status === 401) {
        return 'invalid-credentials';
      }

      if (error.status === 403
        && isRecord(error.error)
        && error.error['code'] === 'access-denied') {
        return 'access-denied';
      }

      if (error.status === 0 || error.status >= 500) {
        return 'communication';
      }
    }

    return 'unexpected';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
