import {
  Inject,
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  Signal,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface BrowserStorageManager {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
  estimate(): Promise<{ readonly usage?: number; readonly quota?: number }>;
}

export type StorageHealthState =
  | { readonly status: 'idle'; readonly supported: boolean }
  | { readonly status: 'unsupported'; readonly supported: false }
  | {
      readonly status: 'healthy' | 'risk';
      readonly supported: true;
      readonly persisted: boolean;
      readonly usage?: number;
      readonly quota?: number;
      readonly usageRatio?: number;
      readonly message?: string;
    };

export const BROWSER_STORAGE_MANAGER =
  new InjectionToken<BrowserStorageManager | null>('BROWSER_STORAGE_MANAGER', {
    providedIn: 'root',
    factory: () => {
      const platformId = inject(PLATFORM_ID);
      if (!isPlatformBrowser(platformId) || typeof globalThis.navigator === 'undefined') {
        return null;
      }
      const storage = globalThis.navigator.storage;
      if (
        !storage
        || typeof storage.persisted !== 'function'
        || typeof storage.persist !== 'function'
        || typeof storage.estimate !== 'function'
      ) {
        return null;
      }
      return storage;
    },
  });

@Injectable({ providedIn: 'root' })
export class StorageHealthService {
  private readonly healthState: WritableSignal<StorageHealthState>;
  private assessment?: Promise<void>;

  readonly state: Signal<StorageHealthState>;

  constructor(
    @Inject(BROWSER_STORAGE_MANAGER)
    private readonly storage: BrowserStorageManager | null,
  ) {
    this.healthState = signal<StorageHealthState>({
      status: 'idle',
      supported: this.storage !== null,
    });
    this.state = this.healthState.asReadonly();
  }

  assess(): Promise<void> {
    this.assessment ??= this.runAssessment();
    return this.assessment;
  }

  private async runAssessment(): Promise<void> {
    if (!this.storage) {
      this.healthState.set({ status: 'unsupported', supported: false });
      return;
    }

    try {
      const alreadyPersisted = await this.storage.persisted();
      const persisted = alreadyPersisted || await this.storage.persist();
      const estimate = await this.storage.estimate();
      const usage = finiteNonNegative(estimate.usage);
      const quota = finitePositive(estimate.quota);
      const usageRatio = usage !== undefined && quota !== undefined
        ? Math.min(usage / quota, 1)
        : undefined;

      this.healthState.set({
        status: persisted ? 'healthy' : 'risk',
        supported: true,
        persisted,
        ...(usage !== undefined ? { usage } : {}),
        ...(quota !== undefined ? { quota } : {}),
        ...(usageRatio !== undefined ? { usageRatio } : {}),
        ...(!persisted
          ? { message: 'O navegador pode remover dados locais quando precisar liberar espaço.' }
          : {}),
      });
    } catch {
      this.healthState.set({
        status: 'risk',
        supported: true,
        persisted: false,
        message: 'Não foi possível confirmar a proteção do armazenamento local.',
      });
    }
  }
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function finitePositive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
