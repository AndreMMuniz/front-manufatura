import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged } from 'rxjs';

import { AuthSession, User } from './auth.models';

/**
 * Facade that holds the current authenticated session in memory.
 *
 * Constraints:
 * - No user, password, token or session is persisted to localStorage,
 *   sessionStorage, cookies or any other browser storage.
 * - Credential validation belongs to the feature LoginService, so the mock
 *   can be replaced by the Datasul endpoint without changing guards or shell.
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly sessionSubject = new BehaviorSubject<AuthSession | null>(null);

  readonly session$: Observable<AuthSession | null> = this.sessionSubject
    .asObservable()
    .pipe(distinctUntilChanged());

  get currentUser() {
    return this.sessionSubject.value?.user ?? null;
  }

  get token(): string | null {
    return this.sessionSubject.value?.token ?? null;
  }

  isAuthenticated(): boolean {
    return this.sessionSubject.value !== null;
  }

  startSession(user: User, token: string): void {
    this.sessionSubject.next({
      user,
      token,
      authenticatedAt: new Date(),
    });
  }

  logout(): void {
    this.sessionSubject.next(null);
  }
}
