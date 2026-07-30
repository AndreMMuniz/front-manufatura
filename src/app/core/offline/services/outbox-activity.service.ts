import { isPlatformBrowser } from '@angular/common';
import {
  Inject,
  Injectable,
  InjectionToken,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { Observable, Subject } from 'rxjs';

const OUTBOX_CHANNEL_NAME = 'plano-de-controle.outbox-activity';

export interface OutboxInvalidation {
  readonly type: 'invalidate';
  readonly version: number;
  readonly origin: string;
}

export interface ActivityChannel {
  postMessage(message: OutboxInvalidation): void;
  close(): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
}

export interface BrowserActivityEnvironment {
  readonly origin: string;
  readonly createChannel: (() => ActivityChannel) | null;
  readonly visibilityState: () => DocumentVisibilityState;
  readonly addEventListener: (
    type: 'focus' | 'visibilitychange',
    listener: () => void,
  ) => void;
  readonly removeEventListener: (
    type: 'focus' | 'visibilitychange',
    listener: () => void,
  ) => void;
}

export const BROWSER_ACTIVITY_ENVIRONMENT =
  new InjectionToken<BrowserActivityEnvironment | null>('BROWSER_ACTIVITY_ENVIRONMENT', {
    providedIn: 'root',
    factory: () => browserEnvironment(inject(PLATFORM_ID)),
  });

@Injectable({ providedIn: 'root' })
export class OutboxActivityService implements OnDestroy {
  private readonly subject = new Subject<OutboxInvalidation>();
  private readonly channel: ActivityChannel | null;
  private version = 0;

  readonly invalidations$: Observable<OutboxInvalidation> = this.subject.asObservable();

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (!isInvalidation(event.data) || event.data.origin === this.environment?.origin) {
      return;
    }
    this.version = Math.max(this.version, event.data.version);
    this.subject.next(event.data);
  };

  private readonly onFocus = (): void => {
    this.emitLocal();
  };

  private readonly onVisibility = (): void => {
    if (this.environment?.visibilityState() === 'visible') {
      this.emitLocal();
    }
  };

  constructor(
    @Inject(BROWSER_ACTIVITY_ENVIRONMENT)
    private readonly environment: BrowserActivityEnvironment | null,
  ) {
    this.channel = this.safeCreateChannel();
    this.channel?.addEventListener('message', this.onMessage);
    this.environment?.addEventListener('focus', this.onFocus);
    this.environment?.addEventListener('visibilitychange', this.onVisibility);
  }

  publish(): void {
    const event = this.emitLocal();
    try {
      this.channel?.postMessage(event);
    } catch {
      // A mesma aba já foi invalidada; foco/visibilidade cobrem o fallback.
    }
  }

  ngOnDestroy(): void {
    this.channel?.removeEventListener('message', this.onMessage);
    this.channel?.close();
    this.environment?.removeEventListener('focus', this.onFocus);
    this.environment?.removeEventListener('visibilitychange', this.onVisibility);
    this.subject.complete();
  }

  private emitLocal(): OutboxInvalidation {
    const event = Object.freeze({
      type: 'invalidate' as const,
      version: ++this.version,
      origin: this.environment?.origin ?? 'server',
    });
    this.subject.next(event);
    return event;
  }

  private safeCreateChannel(): ActivityChannel | null {
    try {
      return this.environment?.createChannel?.() ?? null;
    } catch {
      return null;
    }
  }
}

function browserEnvironment(platformId: object): BrowserActivityEnvironment | null {
  if (
    !isPlatformBrowser(platformId)
    || typeof globalThis.window === 'undefined'
    || typeof globalThis.document === 'undefined'
  ) {
    return null;
  }
  const origin = globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now().toString(36)}`;
  return {
    origin,
    createChannel: typeof globalThis.BroadcastChannel === 'function'
      ? () => new globalThis.BroadcastChannel(OUTBOX_CHANNEL_NAME)
      : null,
    visibilityState: () => globalThis.document.visibilityState,
    addEventListener: (type, listener) => {
      if (type === 'focus') globalThis.window.addEventListener(type, listener);
      else globalThis.document.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      if (type === 'focus') globalThis.window.removeEventListener(type, listener);
      else globalThis.document.removeEventListener(type, listener);
    },
  };
}

function isInvalidation(value: unknown): value is OutboxInvalidation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<OutboxInvalidation>;
  return (
    candidate.type === 'invalidate'
    && Number.isSafeInteger(candidate.version)
    && (candidate.version ?? 0) > 0
    && typeof candidate.origin === 'string'
    && candidate.origin.trim().length > 0
    && Object.keys(value).every(key => ['type', 'version', 'origin'].includes(key))
  );
}
