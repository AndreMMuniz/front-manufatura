import { isPlatformBrowser } from '@angular/common';
import {
  Inject,
  Injectable,
  InjectionToken,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OfflineStorageError } from '../../../core/offline/models/offline-storage-error';
import { OutboxActivityService } from '../../../core/offline/services/outbox-activity.service';
import {
  OutboxPageCursor,
  OutboxRepository,
} from '../../../core/offline/repositories/outbox.repository';
import {
  SynchronizationCounts,
  SynchronizationEntryView,
  SynchronizationFilters,
  SynchronizationModule,
  mapSynchronizationEntry,
} from '../models/synchronization-view.model';

export const SYNCHRONIZATION_CENTER_BROWSER = new InjectionToken<boolean>(
  'SYNCHRONIZATION_CENTER_BROWSER',
  {
    providedIn: 'root',
    factory: () => isPlatformBrowser(inject(PLATFORM_ID))
      && typeof globalThis.window !== 'undefined',
  },
);

export interface SynchronizationCenterState {
  readonly ownerId: string | null;
  readonly readState: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  readonly items: readonly SynchronizationEntryView[];
  readonly counts: SynchronizationCounts;
  readonly filters: SynchronizationFilters;
  readonly nextCursor: OutboxPageCursor | null;
  readonly hasMore: boolean;
  readonly errorMessage?: string;
  readonly loadMoreError?: string;
}

const EMPTY_COUNTS: SynchronizationCounts = Object.freeze({
  pending: 0,
  error: 0,
  syncing: 0,
  receipts: 0,
});

const EMPTY_FILTERS: SynchronizationFilters = Object.freeze({
  statuses: Object.freeze([]),
  modules: Object.freeze([]),
});

@Injectable({ providedIn: 'root' })
export class SynchronizationCenterService implements OnDestroy {
  private readonly stateSubject = new BehaviorSubject<SynchronizationCenterState>(
    emptyState(),
  );
  private readonly sessionSubscription?: Subscription;
  private readonly activitySubscription?: Subscription;
  private requestVersion = 0;
  private ownerEpoch = 0;

  readonly state$: Observable<SynchronizationCenterState> = this.stateSubject.asObservable();

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly auth: AuthSessionService,
    @Inject(SYNCHRONIZATION_CENTER_BROWSER) private readonly browser: boolean,
    private readonly activity: OutboxActivityService = new OutboxActivityService(null),
  ) {
    if (browser) {
      this.sessionSubscription = this.auth.session$.subscribe(session => {
        const ownerId = session?.user.id.trim() || null;
        this.ownerEpoch += 1;
        this.requestVersion += 1;
        this.stateSubject.next(emptyState(ownerId, this.snapshot.filters));
        if (ownerId) {
          void this.refresh();
        }
      });
      this.activitySubscription = this.activity.invalidations$.subscribe(() => {
        if (this.auth.currentUser) void this.refresh();
      });
    }
  }

  get snapshot(): SynchronizationCenterState {
    return this.stateSubject.value;
  }

  setFilters(filters: SynchronizationFilters): void {
    const normalized = normalizeFilters(filters);
    this.requestVersion += 1;
    this.stateSubject.next({
      ...this.snapshot,
      filters: normalized,
      items: Object.freeze([]),
      nextCursor: null,
      hasMore: false,
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.browser) return;
    const ownerId = this.auth.currentUser?.id.trim() || null;
    if (!ownerId) {
      this.stateSubject.next(emptyState(null, this.snapshot.filters));
      return;
    }
    const epoch = this.ownerEpoch;
    const version = ++this.requestVersion;
    const filters = this.snapshot.filters;
    this.stateSubject.next({
      ...this.snapshot,
      ownerId,
      readState: 'loading',
      items: Object.freeze([]),
      nextCursor: null,
      hasMore: false,
      errorMessage: undefined,
      loadMoreError: undefined,
    });
    try {
      const [page, counts] = await Promise.all([
        this.outbox.listPage(pageQuery(ownerId, filters)),
        this.outbox.summarizeOwner(ownerId),
      ]);
      if (!this.isCurrent(ownerId, epoch, version)) return;
      this.stateSubject.next(Object.freeze({
        ownerId,
        readState: 'ready',
        items: Object.freeze(page.items.map(mapSynchronizationEntry)),
        counts,
        filters,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loadMoreError: undefined,
      }));
    } catch (error) {
      if (!this.isCurrent(ownerId, epoch, version)) return;
      const unavailable = error instanceof OfflineStorageError
        && error.code === 'CAPABILITY_UNAVAILABLE';
      this.stateSubject.next(Object.freeze({
        ...emptyState(ownerId, filters),
        readState: unavailable ? 'unavailable' : 'error',
        errorMessage: unavailable
          ? 'O armazenamento local não está disponível neste dispositivo.'
          : 'Não foi possível ler os registros locais.',
      }));
    }
  }

  async loadMore(): Promise<void> {
    const current = this.snapshot;
    if (
      !this.browser
      || current.readState !== 'ready'
      || !current.ownerId
      || !current.hasMore
      || !current.nextCursor
    ) {
      return;
    }
    const ownerId = current.ownerId;
    const epoch = this.ownerEpoch;
    const version = ++this.requestVersion;
    try {
      const page = await this.outbox.listPage({
        ...pageQuery(ownerId, current.filters),
        cursor: current.nextCursor,
      });
      if (!this.isCurrent(ownerId, epoch, version)) return;
      this.stateSubject.next(Object.freeze({
        ...current,
        items: Object.freeze([...current.items, ...page.items.map(mapSynchronizationEntry)]),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loadMoreError: undefined,
      }));
    } catch {
      if (!this.isCurrent(ownerId, epoch, version)) return;
      this.stateSubject.next(Object.freeze({
        ...current,
        loadMoreError: 'Não foi possível carregar mais registros. Tente novamente.',
      }));
    }
  }

  ngOnDestroy(): void {
    this.requestVersion += 1;
    this.ownerEpoch += 1;
    this.sessionSubscription?.unsubscribe();
    this.activitySubscription?.unsubscribe();
    this.stateSubject.complete();
  }

  private isCurrent(ownerId: string, epoch: number, version: number): boolean {
    return (
      this.ownerEpoch === epoch
      && this.requestVersion === version
      && this.auth.currentUser?.id.trim() === ownerId
    );
  }
}

function emptyState(
  ownerId: string | null = null,
  filters: SynchronizationFilters = EMPTY_FILTERS,
): SynchronizationCenterState {
  return Object.freeze({
    ownerId,
    readState: 'idle',
    items: Object.freeze([]),
    counts: EMPTY_COUNTS,
    filters,
    nextCursor: null,
    hasMore: false,
  });
}

function normalizeFilters(filters: SynchronizationFilters): SynchronizationFilters {
  const identification = filters.identification?.normalize('NFC').trim().slice(0, 120);
  return Object.freeze({
    statuses: Object.freeze([...new Set(filters.statuses)]),
    modules: Object.freeze([...new Set(filters.modules)]),
    ...(filters.occurredFrom ? { occurredFrom: filters.occurredFrom } : {}),
    ...(filters.occurredTo ? { occurredTo: filters.occurredTo } : {}),
    ...(identification ? { identification } : {}),
  });
}

function pageQuery(ownerId: string, filters: SynchronizationFilters) {
  const normalizedIdentification = normalizeSearch(filters.identification);
  const modules = new Set<SynchronizationModule>(filters.modules);
  return {
    ownerId,
    pageSize: 25,
    statuses: filters.statuses,
    ...(filters.occurredFrom ? { occurredFrom: filters.occurredFrom } : {}),
    ...(filters.occurredTo ? { occurredTo: filters.occurredTo } : {}),
    ...(normalizedIdentification || modules.size > 0
      ? {
          matchesIdentification: (
            source: Parameters<typeof mapSynchronizationEntry>[0],
          ) => {
            const view = mapSynchronizationEntry(source);
            return (
              (!modules.size || modules.has(view.module))
              && (!normalizedIdentification
                || normalizeSearch(view.operationalIdentification)
                  .includes(normalizedIdentification))
            );
          },
        }
      : {}),
  };
}

function normalizeSearch(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}
