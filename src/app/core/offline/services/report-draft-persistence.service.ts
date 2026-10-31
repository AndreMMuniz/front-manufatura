import { Inject, Injectable, InjectionToken } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { AuthenticatedApiService } from '../../http/authenticated-api.service';

export const REPORT_DRAFT_STORAGE = new InjectionToken<Storage | null>('REPORT_DRAFT_STORAGE', {
  providedIn: 'root',
  factory: () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } },
});

/** Editable drafts only: never updates commands, receipts or the outbox. */
@Injectable({ providedIn: 'root' })
export class ReportDraftPersistence {
  private company: Promise<string> | null = null;
  private readonly revisions = new Map<string, number>();
  private readonly activeRevisions = new Map<string, number>();
  constructor(
    private readonly auth: AuthSessionService,
    private readonly api: AuthenticatedApiService,
    @Inject(REPORT_DRAFT_STORAGE) private readonly storage: Storage | null,
  ) {}

  async saveActive(kind: 'operation' | 'batch', identity: string, snapshot: unknown): Promise<void> {
    const revision = (this.activeRevisions.get(kind) ?? 0) + 1;
    this.activeRevisions.set(kind, revision);
    const key = 'active-' + kind + '|' + identity;
    if (await this.write(key, snapshot) && this.activeRevisions.get(kind) === revision) await this.write('active-' + kind + '-index', { key });
  }

  async readActive<T>(kind: 'operation' | 'batch'): Promise<T | null> {
    const index = await this.read<{ key: string }>('active-' + kind + '-index');
    return typeof index?.key === 'string' && index.key.startsWith('active-' + kind + '|') ? this.read<T>(index.key) : null;
  }

  async clearActive(kind: 'operation' | 'batch'): Promise<void> {
    const revision = (this.activeRevisions.get(kind) ?? 0) + 1;
    this.activeRevisions.set(kind, revision);
    const index = await this.read<{ key: string }>('active-' + kind + '-index');
    if (this.activeRevisions.get(kind) !== revision) return;
    await this.write('active-' + kind + '-index', null);
    if (typeof index?.key === 'string' && index.key.startsWith('active-' + kind + '|')) await this.write(index.key, null);
  }

  async read<T>(identity: string): Promise<T | null> {
    const owner = this.auth.currentUser?.id;
    if (!owner || !identity) return null;
    try {
      const key = await this.key(owner, identity);
      if (owner !== this.auth.currentUser?.id || !key) return null;
      const raw = this.storage?.getItem(key);
      const saved = raw ? JSON.parse(raw) : null;
      return saved?.schemaVersion === 2 ? saved.data as T : null;
    } catch { return null; }
  }

  async write(identity: string, data: unknown | null): Promise<boolean> {
    const owner = this.auth.currentUser?.id;
    if (!owner || !identity || !this.storage) return false;
    const slot = JSON.stringify([owner, identity]);
    const revision = (this.revisions.get(slot) ?? 0) + 1;
    this.revisions.set(slot, revision);
    try {
      // Capture synchronously, before awaiting company discovery or another edit.
      const raw = data === null ? null : JSON.stringify({ schemaVersion: 2, data });
      const key = await this.key(owner, identity);
      if (!key || owner !== this.auth.currentUser?.id) return false;
      if (this.revisions.get(slot) !== revision) return true;
      if (raw === null) this.storage.removeItem(key);
      else this.storage.setItem(key, raw);
      return true;
    } catch { return false; }
  }

  private async key(owner: string, identity: string): Promise<string | null> {
    const cacheKey = 'plano-de-controle.reporting-company.' + owner;
    const offline = this.auth.mode === 'OFFLINE' || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (offline) {
      const company = this.storage?.getItem(cacheKey);
      return company ? 'plano-de-controle.report-draft.v2.' + JSON.stringify([owner, company, identity]) : null;
    }
    if (!this.company) {
      this.company = firstValueFrom(this.api.get<{ companyId: string }>('/api/reporting-scope'))
        .then(scope => {
          if (typeof scope.companyId !== 'string' || !scope.companyId.trim()) throw new Error('invalid-company-scope');
          this.storage?.setItem(cacheKey, scope.companyId);
          return scope.companyId;
        }).catch(() => { this.company = null; return ''; });
    }
    const company = await this.company;
    // Fail closed if the deployment company cannot be verified. Never read a
    // draft from an assumed tenant, including after a deployment reconfiguration.
    return company ? 'plano-de-controle.report-draft.v2.' + JSON.stringify([owner, company, identity]) : null;
  }
}
