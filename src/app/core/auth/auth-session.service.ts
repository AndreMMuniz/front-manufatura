import { Inject, Injectable, InjectionToken } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged } from 'rxjs';

import {
  AuthSession,
  OfflineContinuityMetadata,
  SessionExpirationMetadata,
  User,
} from './auth.models';

const AUTH_SESSION_STORAGE_KEY = 'plano-de-controle.auth-session';
const AUTH_SESSION_SNAPSHOT_VERSION = 2;

export type AuthClock = () => Date;
export type AuthExpiryScheduler = (callback: () => void, delayMs: number) => () => void;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface PersistedAuthSession {
  readonly version: typeof AUTH_SESSION_SNAPSHOT_VERSION;
  readonly ownerId: string;
  readonly user: User;
  readonly authenticatedAt: string;
  readonly lastValidatedAt: string;
  readonly expiresAt: string;
}

export interface OfflineSessionPolicy {
  isValid(snapshot: PersistedAuthSession, now: Date): boolean;
}

const STRICT_OFFLINE_SESSION_POLICY: OfflineSessionPolicy = {
  isValid: (snapshot, now) => {
    const authenticatedAt = Date.parse(snapshot.authenticatedAt);
    const lastValidatedAt = Date.parse(snapshot.lastValidatedAt);
    const expiresAt = Date.parse(snapshot.expiresAt);
    const nowTime = now.getTime();

    return Number.isFinite(authenticatedAt)
      && Number.isFinite(lastValidatedAt)
      && Number.isFinite(expiresAt)
      && authenticatedAt <= lastValidatedAt
      && lastValidatedAt <= nowTime
      && nowTime < expiresAt;
  },
};

export const AUTH_SESSION_STORAGE = new InjectionToken<Storage | null>(
  'AUTH_SESSION_STORAGE',
  {
    providedIn: 'root',
    factory: () => browserSessionStorage(),
  },
);

export const AUTH_CLOCK = new InjectionToken<AuthClock>('AUTH_CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

export const AUTH_EXPIRY_SCHEDULER = new InjectionToken<AuthExpiryScheduler>(
  'AUTH_EXPIRY_SCHEDULER',
  {
    providedIn: 'root',
    factory: () => scheduleAuthExpiry,
  },
);

export const OFFLINE_SESSION_POLICY = new InjectionToken<OfflineSessionPolicy>(
  'OFFLINE_SESSION_POLICY',
  {
    providedIn: 'root',
    factory: () => STRICT_OFFLINE_SESSION_POLICY,
  },
);

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly sessionSubject: BehaviorSubject<AuthSession | null>;
  private cancelExpiry?: () => void;

  readonly session$: Observable<AuthSession | null>;

  constructor(
    @Inject(AUTH_SESSION_STORAGE)
    private readonly storage: Storage | null = browserSessionStorage(),
    @Inject(AUTH_CLOCK)
    private readonly clock: AuthClock = () => new Date(),
    @Inject(OFFLINE_SESSION_POLICY)
    private readonly policy: OfflineSessionPolicy = STRICT_OFFLINE_SESSION_POLICY,
    @Inject(AUTH_EXPIRY_SCHEDULER)
    private readonly expiryScheduler: AuthExpiryScheduler = scheduleAuthExpiry,
  ) {
    this.sessionSubject = new BehaviorSubject<AuthSession | null>(this.restoreSession());
    this.session$ = this.sessionSubject.asObservable().pipe(distinctUntilChanged());
    this.scheduleCurrentExpiry();
  }

  get currentUser(): User | null {
    return this.currentSession()?.user ?? null;
  }

  get token(): string | null {
    return this.currentSession()?.token ?? null;
  }

  get mode(): AuthSession['mode'] | null {
    return this.currentSession()?.mode ?? null;
  }

  isAuthenticated(): boolean {
    return this.currentSession() !== null;
  }

  hasRemoteCredential(): boolean {
    const session = this.currentSession();
    return session?.mode === 'ONLINE' && Boolean(session.token);
  }

  startSession(
    user: User,
    token: string,
    online: SessionExpirationMetadata,
    continuity?: OfflineContinuityMetadata,
  ): void {
    if (!token.trim()) {
      throw new Error('Credencial remota inválida.');
    }

    const now = validDate(this.clock());
    const expiresAt = this.validFutureDate(online.expiresAt, now);
    if (!expiresAt) {
      throw new Error('Expiração online inválida.');
    }
    const requestedOfflineExpiry = continuity
      ? this.validFutureDate(continuity.expiresAt, now)
      : null;
    const offlineExpiresAt = requestedOfflineExpiry
      ? new Date(Math.min(requestedOfflineExpiry.getTime(), expiresAt.getTime()))
      : null;
    const session: AuthSession = {
      user: copyUser(user),
      mode: 'ONLINE',
      token,
      authenticatedAt: now,
      lastValidatedAt: now,
      ...(expiresAt ? { expiresAt } : {}),
    };

    if (offlineExpiresAt) {
      this.persistSession({
        version: AUTH_SESSION_SNAPSHOT_VERSION,
        ownerId: user.id,
        user: copyUser(user),
        authenticatedAt: now.toISOString(),
        lastValidatedAt: now.toISOString(),
        expiresAt: offlineExpiresAt.toISOString(),
      });
    } else {
      this.removePersistedSession();
    }
    this.sessionSubject.next(session);
    this.scheduleCurrentExpiry();
  }

  logout(): void {
    this.cancelScheduledExpiry();
    this.removePersistedSession();
    this.sessionSubject.next(null);
  }

  private currentSession(): AuthSession | null {
    const session = this.sessionSubject.value;
    if (
      session?.expiresAt
      && this.clock().getTime() >= session.expiresAt.getTime()
    ) {
      this.logout();
      return null;
    }
    return session;
  }

  private scheduleCurrentExpiry(): void {
    this.cancelScheduledExpiry();
    const session = this.sessionSubject.value;
    if (!session?.expiresAt) {
      return;
    }

    const remainingMs = session.expiresAt.getTime() - validDate(this.clock()).getTime();
    if (remainingMs <= 0) {
      this.logout();
      return;
    }

    this.cancelExpiry = this.expiryScheduler(
      () => {
        this.cancelExpiry = undefined;
        if (this.currentSession()) {
          this.scheduleCurrentExpiry();
        }
      },
      Math.min(remainingMs, MAX_TIMER_DELAY_MS),
    );
  }

  private cancelScheduledExpiry(): void {
    this.cancelExpiry?.();
    this.cancelExpiry = undefined;
  }

  private restoreSession(): AuthSession | null {
    if (!this.storage) {
      return null;
    }

    try {
      const serializedSession = this.storage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (!serializedSession) {
        return null;
      }

      const value: unknown = JSON.parse(serializedSession);
      if (!this.isPersistedSession(value) || !this.policy.isValid(value, validDate(this.clock()))) {
        this.removePersistedSession();
        return null;
      }

      return {
        user: copyUser(value.user),
        mode: 'OFFLINE',
        authenticatedAt: new Date(value.authenticatedAt),
        lastValidatedAt: new Date(value.lastValidatedAt),
        expiresAt: new Date(value.expiresAt),
      };
    } catch {
      this.removePersistedSession();
      return null;
    }
  }

  private persistSession(snapshot: PersistedAuthSession): void {
    try {
      this.storage?.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // A sessão online em memória continua válida quando sessionStorage falha.
    }
  }

  private removePersistedSession(): void {
    try {
      this.storage?.removeItem(AUTH_SESSION_STORAGE_KEY);
    } catch {
      // Não há ação adicional segura quando o storage está indisponível.
    }
  }

  private validFutureDate(value: string, now: Date): Date | null {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()
      ? parsed
      : null;
  }

  private isPersistedSession(value: unknown): value is PersistedAuthSession {
    if (!isRecord(value) || !isRecord(value['user'])) {
      return false;
    }

    const user = value['user'];
    return value['version'] === AUTH_SESSION_SNAPSHOT_VERSION
      && hasOnlyKeys(value, [
        'version',
        'ownerId',
        'user',
        'authenticatedAt',
        'lastValidatedAt',
        'expiresAt',
      ])
      && hasOnlyKeys(user, ['id', 'nome', 'login', 'permissoes'])
      && typeof value['ownerId'] === 'string'
      && value['ownerId'] === user['id']
      && typeof user['id'] === 'string'
      && user['id'].trim().length > 0
      && typeof user['nome'] === 'string'
      && typeof user['login'] === 'string'
      && Array.isArray(user['permissoes'])
      && user['permissoes'].every(permission => typeof permission === 'string')
      && typeof value['authenticatedAt'] === 'string'
      && typeof value['lastValidatedAt'] === 'string'
      && typeof value['expiresAt'] === 'string';
  }
}

function browserSessionStorage(): Storage | null {
  return typeof globalThis.sessionStorage === 'undefined'
    ? null
    : globalThis.sessionStorage;
}

function copyUser(user: User): User {
  return {
    id: user.id,
    nome: user.nome,
    login: user.login,
    permissoes: [...user.permissoes],
  };
}

function validDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Relógio de autenticação inválido.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every(key => allowed.has(key));
}

function scheduleAuthExpiry(callback: () => void, delayMs: number): () => void {
  const handle = globalThis.setTimeout(callback, delayMs);
  if (typeof handle === 'object' && handle !== null && 'unref' in handle) {
    (handle as { unref(): void }).unref();
  }
  return () => globalThis.clearTimeout(handle);
}
