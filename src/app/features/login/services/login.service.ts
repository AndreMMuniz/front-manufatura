import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, tap, throwError } from 'rxjs';

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
  private readonly http = inject(HttpClient);
  private readonly authSession = inject(AuthSessionService);

  login(login: string, senha: string): Observable<LoginAutenticado> {
    const request: LoginRequestDTO = {
      login: login.trim(),
      senha: senha.trim(),
    };

    if (!request.login || !request.senha) {
      return throwError(() => new LoginError('invalid-credentials'));
    }

    return this.http.post<LoginResponseDTO>('/api/auth/login', request).pipe(
      map(response => mapLoginResponse(response)),
      tap(result => this.authSession.startSession(result.usuario, result.token)),
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

      if (error.status === 0 || error.status >= 500) {
        return 'communication';
      }
    }

    return 'unexpected';
  }
}
