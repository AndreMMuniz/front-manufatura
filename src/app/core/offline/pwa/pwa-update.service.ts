import {
  Inject,
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import { Observable } from 'rxjs';
import { AuthSessionService } from '../../auth/auth-session.service';
import { OutboxRepository } from '../repositories/outbox.repository';
import { PwaWorkStateService } from './pwa-work-state.service';

export type PwaUpdateState =
  | { readonly status: 'disabled' }
  | { readonly status: 'up-to-date' }
  | { readonly status: 'checking'; readonly versionHash?: string }
  | {
      readonly status: 'ready';
      readonly currentVersionHash: string;
      readonly versionHash: string;
    }
  | {
      readonly status: 'install-failed';
      readonly versionHash?: string;
      readonly message: string;
    }
  | { readonly status: 'unrecoverable'; readonly message: string };

export interface SwUpdateFacade {
  readonly isEnabled: boolean;
  readonly versionUpdates: Observable<unknown>;
  readonly unrecoverable: Observable<{ readonly reason: string }>;
  checkForUpdate(): Promise<boolean>;
}

export interface BrowserReload {
  reload(): void;
}

export type PwaReloadResult =
  | 'reloaded'
  | 'not-ready'
  | 'capture-active'
  | 'pending-outbox'
  | 'storage-unavailable';

export const BROWSER_RELOAD = new InjectionToken<BrowserReload | null>('BROWSER_RELOAD', {
  providedIn: 'root',
  factory: () => {
    const platformId = inject(PLATFORM_ID);
    if (!isPlatformBrowser(platformId) || typeof globalThis.location === 'undefined') {
      return null;
    }
    return { reload: () => globalThis.location.reload() };
  },
});

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private readonly updateState = signal<PwaUpdateState>({ status: 'disabled' });
  private started = false;

  readonly state = this.updateState.asReadonly();

  constructor(
    @Inject(SwUpdate) private readonly swUpdate: SwUpdateFacade,
    @Inject(BROWSER_RELOAD) private readonly browserReload: BrowserReload | null,
    @Inject(AuthSessionService)
    private readonly authSession: Pick<AuthSessionService, 'currentUser'> | null = null,
    @Inject(OutboxRepository)
    private readonly outbox: Pick<OutboxRepository, 'listByOwner'> | null = null,
    @Inject(PwaWorkStateService)
    private readonly workState: Pick<PwaWorkStateService, 'hasActiveCapture'> | null = null,
  ) {}

  start(): void {
    if (this.started || !this.swUpdate.isEnabled) {
      return;
    }

    this.started = true;
    this.updateState.set({ status: 'checking' });

    this.swUpdate.versionUpdates.subscribe((event) => this.handleVersionEvent(event));
    this.swUpdate.unrecoverable.subscribe(() => {
      this.updateState.set({
        status: 'unrecoverable',
        message: 'A aplicação precisa ser recarregada com conexão para se recuperar.',
      });
    });

    void this.swUpdate.checkForUpdate()
      .then(found => {
        if (!found && this.updateState().status === 'checking') {
          this.updateState.set({ status: 'up-to-date' });
        }
      })
      .catch(() => {
        this.updateState.set({
          status: 'install-failed',
          message: 'Não foi possível verificar atualizações.',
        });
      });
  }

  async reloadWhenSafe(confirmPendingWork = false): Promise<PwaReloadResult> {
    if (
      !['ready', 'unrecoverable'].includes(this.updateState().status)
      || !this.browserReload
    ) {
      return 'not-ready';
    }

    if (this.workState?.hasActiveCapture()) {
      return 'capture-active';
    }

    const ownerId = this.authSession?.currentUser?.id.trim();
    if (ownerId && this.outbox) {
      try {
        const entries = await this.outbox.listByOwner(ownerId);
        if (!confirmPendingWork && entries.some(entry => entry.status !== 'SYNCED')) {
          return 'pending-outbox';
        }
      } catch {
        return 'storage-unavailable';
      }
    }

    this.browserReload.reload();
    return 'reloaded';
  }

  private handleVersionEvent(event: unknown): void {
    if (!this.isRecord(event) || typeof event['type'] !== 'string') {
      return;
    }

    const versionHash = this.hashFrom(event['version']);

    switch (event['type']) {
      case 'VERSION_DETECTED':
        this.updateState.set({
          status: 'checking',
          ...(versionHash ? { versionHash } : {}),
        });
        break;
      case 'VERSION_READY': {
        const currentVersionHash = this.hashFrom(event['currentVersion']);
        const latestVersionHash = this.hashFrom(event['latestVersion']);
        if (currentVersionHash && latestVersionHash) {
          this.updateState.set({
            status: 'ready',
            currentVersionHash,
            versionHash: latestVersionHash,
          });
        }
        break;
      }
      case 'NO_NEW_VERSION_DETECTED':
        this.updateState.set({ status: 'up-to-date' });
        break;
      case 'VERSION_INSTALLATION_FAILED':
      case 'VERSION_FAILED':
        this.updateState.set({
          status: 'install-failed',
          ...(versionHash ? { versionHash } : {}),
          message: 'Não foi possível preparar a atualização.',
        });
        break;
    }
  }

  private hashFrom(value: unknown): string | undefined {
    return this.isRecord(value) && typeof value['hash'] === 'string'
      ? value['hash']
      : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
