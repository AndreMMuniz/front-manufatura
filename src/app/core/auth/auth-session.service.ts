import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged } from 'rxjs';

import { AuthSession } from './auth.models';

/**
 * Facade that holds the current authenticated session in memory.
 *
 * This service is intentionally small and replaceable. The mock
 * implementation below validates a single deterministic credential pair
 * (`operador` / `mock123`) so the login flow can be demonstrated while the
 * real Datasul authentication contract is not yet available.
 *
 * Future Datasul integration:
 * - Replace `login()` with an HTTP call to the Datasul authentication endpoint.
 * - Store the returned user profile / token in the `AuthSession` object.
 * - Keep the public API (`session$`, `currentUser`, `isAuthenticated()`,
 *   `logout()`) unchanged so pages and guards do not need to change.
 *
 * Constraints:
 * - No user, password, token or session is persisted to localStorage,
 *   sessionStorage, cookies or any other browser storage.
 * - The service does not create a parallel user registry; it only reflects
 *   the authenticated session provided by the back-end (or by the mock).
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private static readonly mockUser = 'operador';
  private static readonly mockPassword = 'mock123';

  private readonly sessionSubject = new BehaviorSubject<AuthSession | null>(null);

  readonly session$: Observable<AuthSession | null> = this.sessionSubject
    .asObservable()
    .pipe(distinctUntilChanged());

  get currentUser() {
    return this.sessionSubject.value?.user ?? null;
  }

  isAuthenticated(): boolean {
    return this.sessionSubject.value !== null;
  }

  login(username: string, password: string): boolean {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return false;
    }

    const trimmedUser = username.trim();
    const trimmedPassword = password.trim();

    if (trimmedUser !== AuthSessionService.mockUser || trimmedPassword !== AuthSessionService.mockPassword) {
      return false;
    }

    this.sessionSubject.next({
      user: { username: trimmedUser },
      authenticatedAt: new Date(),
    });

    return true;
  }

  logout(): void {
    this.sessionSubject.next(null);
  }
}
