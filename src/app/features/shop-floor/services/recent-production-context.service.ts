import { Inject, Injectable, InjectionToken } from '@angular/core';

import { AuthSessionService } from '../../../core/auth/auth-session.service';

const STORAGE_PREFIX = 'plano-de-controle.recent-production-contexts.';
const MAX_RECENT_CONTEXTS = 5;

export interface RecentProductionContext {
  readonly areaCode: string;
  readonly lastUsedAt: string;
}

export const RECENT_PRODUCTION_CONTEXT_STORAGE = new InjectionToken<Storage | null>(
  'RECENT_PRODUCTION_CONTEXT_STORAGE',
  { providedIn: 'root', factory: browserLocalStorage },
);

export const RECENT_PRODUCTION_CONTEXT_CLOCK = new InjectionToken<() => Date>(
  'RECENT_PRODUCTION_CONTEXT_CLOCK',
  { providedIn: 'root', factory: () => () => new Date() },
);

@Injectable({ providedIn: 'root' })
export class RecentProductionContextService {
  constructor(
    private readonly auth: AuthSessionService,
    @Inject(RECENT_PRODUCTION_CONTEXT_STORAGE) private readonly storage: Storage | null,
    @Inject(RECENT_PRODUCTION_CONTEXT_CLOCK) private readonly clock: () => Date,
  ) {}

  list(): ReadonlyArray<RecentProductionContext> {
    const key = this.storageKey();
    if (!key || !this.storage) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(key) ?? '[]');
      if (!Array.isArray(parsed)) {
        return [];
      }
      const seen = new Set<string>();
      const contexts: RecentProductionContext[] = [];
      for (const item of parsed) {
        if (!isRecentContext(item)) continue;
        const areaCode = normalizeCode(item.areaCode);
        if (seen.has(areaCode)) continue;
        seen.add(areaCode);
        contexts.push({ areaCode, lastUsedAt: item.lastUsedAt });
        if (contexts.length === MAX_RECENT_CONTEXTS) break;
      }
      if (JSON.stringify(parsed) !== JSON.stringify(contexts)) {
        try {
          this.storage.setItem(key, JSON.stringify(contexts));
        } catch {
          // O histórico sanitizado ainda pode ser exibido quando o storage está somente leitura.
        }
      }
      return contexts.map(item => ({ ...item }));
    } catch {
      return [];
    }
  }

  remember(areaCode: string): void {
    const key = this.storageKey();
    const area = normalizeCode(areaCode);
    if (!key || !this.storage || !area) {
      return;
    }
    const context: RecentProductionContext = {
      areaCode: area,
      lastUsedAt: this.clock().toISOString(),
    };
    const contexts = [
      context,
      ...this.list().filter(item => item.areaCode !== area),
    ].slice(0, MAX_RECENT_CONTEXTS);
    try {
      this.storage.setItem(key, JSON.stringify(contexts));
    } catch {
      // A consulta continua funcionando quando o armazenamento do navegador falha.
    }
  }

  private storageKey(): string | null {
    const ownerId = this.auth.currentUser?.id?.trim();
    return ownerId ? `${STORAGE_PREFIX}${ownerId}` : null;
  }
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function isRecentContext(value: unknown): value is RecentProductionContext {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<RecentProductionContext>;
  return typeof item.areaCode === 'string' && Boolean(item.areaCode.trim())
    && typeof item.lastUsedAt === 'string' && Number.isFinite(Date.parse(item.lastUsedAt));
}

function browserLocalStorage(): Storage | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}
