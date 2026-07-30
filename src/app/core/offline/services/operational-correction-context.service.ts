import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { AuthSessionService } from '../../auth/auth-session.service';
import { JsonValue } from '../models/local-record';
import { OperationalCommandType } from '../models/operational-command';

export interface OperationalCorrectionDraft {
  readonly ownerId: string;
  readonly sourceLocalId: string;
  readonly commandType: OperationalCommandType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payloadSchemaVersion: number;
  readonly draft: JsonValue;
}

@Injectable({ providedIn: 'root' })
export class OperationalCorrectionContextService implements OnDestroy {
  private pending: OperationalCorrectionDraft | null = null;
  private epoch = 0;
  private readonly subscription: Subscription;

  constructor(private readonly auth: AuthSessionService) {
    this.subscription = this.auth.session$.subscribe(session => {
      this.epoch += 1;
      const ownerId = session?.user?.id?.trim();
      if (!ownerId || this.pending?.ownerId !== ownerId) {
        this.pending = null;
      }
    });
  }

  activate(draft: OperationalCorrectionDraft): boolean {
    const ownerId = this.auth.currentUser?.id.trim();
    if (!ownerId || ownerId !== draft.ownerId.trim()) return false;
    this.pending = deepFreezeCopy({
      ...draft,
      ownerId,
      sourceLocalId: draft.sourceLocalId.trim(),
      aggregateType: draft.aggregateType.trim(),
      aggregateId: draft.aggregateId.trim(),
    });
    return true;
  }

  current(ownerId: string): OperationalCorrectionDraft | null {
    if (
      this.auth.currentUser?.id.trim() !== ownerId
      || this.pending?.ownerId !== ownerId
    ) {
      return null;
    }
    return deepFreezeCopy(this.pending);
  }

  matching(
    ownerId: string,
    commandType: OperationalCommandType,
  ): OperationalCorrectionDraft | null {
    const current = this.current(ownerId);
    return current
      && current.commandType === commandType
      ? current
      : null;
  }

  currentEpoch(): number {
    return this.epoch;
  }

  isCurrent(ownerId: string, epoch: number): boolean {
    return this.epoch === epoch && this.auth.currentUser?.id.trim() === ownerId;
  }

  watch(listener: () => void): () => void {
    const subscription = this.auth.session$.subscribe(listener);
    return () => subscription.unsubscribe();
  }

  clear(sourceLocalId?: string): void {
    if (!sourceLocalId || this.pending?.sourceLocalId === sourceLocalId) {
      this.pending = null;
    }
  }

  ngOnDestroy(): void {
    this.pending = null;
    this.epoch += 1;
    this.subscription.unsubscribe();
  }
}

function deepFreezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  return deepFreeze(copy);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
