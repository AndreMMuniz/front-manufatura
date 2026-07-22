import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged } from 'rxjs';

import { AuthSession, User } from './auth.models';

const AUTH_SESSION_STORAGE_KEY = 'plano-de-controle.auth-session';

/**
 * Facade that holds the current authenticated session for the active browser
 * tab. sessionStorage survives page reloads, but is cleared when the tab is
 * closed and is never accessed during server-side rendering.
 *
 * Constraints:
 * - Credentials are never persisted.
 * - Credential validation belongs to the feature LoginService, so the mock
 *   can be replaced by the Datasul endpoint without changing guards or shell.
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly sessionSubject = new BehaviorSubject<AuthSession | null>(this.restoreSession());

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
    const session: AuthSession = {
      user,
      token,
      authenticatedAt: new Date(),
    };

    this.persistSession(session);
    this.sessionSubject.next(session);
  }

  logout(): void {
    this.removePersistedSession();
    this.sessionSubject.next(null);
  }

  private restoreSession(): AuthSession | null {
    const storage = this.browserSessionStorage();

    if (!storage) {
      return null;
    }

    try {
      const serializedSession = storage.getItem(AUTH_SESSION_STORAGE_KEY);

      if (!serializedSession) {
        return null;
      }

      const value: unknown = JSON.parse(serializedSession);

      if (!this.isPersistedSession(value)) {
        storage.removeItem(AUTH_SESSION_STORAGE_KEY);
        return null;
      }

      return {
        user: value.user,
        token: value.token,
        authenticatedAt: new Date(value.authenticatedAt),
      };
    } catch {
      this.removePersistedSession();
      return null;
    }
  }

  private persistSession(session: AuthSession): void {
    try {
      this.browserSessionStorage()?.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Browsers can disable storage. The in-memory session still remains valid.
    }
  }

  private removePersistedSession(): void {
    try {
      this.browserSessionStorage()?.removeItem(AUTH_SESSION_STORAGE_KEY);
    } catch {
      // Nothing else is required when browser storage is unavailable.
    }
  }

  private browserSessionStorage(): Storage | null {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  }

  private isPersistedSession(value: unknown): value is {
    user: User;
    token: string;
    authenticatedAt: string;
  } {
    if (!this.isRecord(value) || !this.isRecord(value['user'])) {
      return false;
    }

    const user = value['user'];
    const authenticatedAt = value['authenticatedAt'];

    return typeof value['token'] === 'string'
      && value['token'].length > 0
      && typeof authenticatedAt === 'string'
      && !Number.isNaN(Date.parse(authenticatedAt))
      && typeof user['id'] === 'string'
      && typeof user['nome'] === 'string'
      && typeof user['login'] === 'string'
      && Array.isArray(user['permissoes'])
      && user['permissoes'].every(permission => typeof permission === 'string');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
