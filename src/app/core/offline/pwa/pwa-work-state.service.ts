import { Injectable, computed, signal, untracked } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PwaWorkStateService {
  private readonly activeCaptures = signal<ReadonlySet<string>>(new Set());

  readonly hasActiveCapture = computed(() => this.activeCaptures().size > 0);

  setCaptureActive(source: string, active: boolean): void {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      throw new Error('A origem da captura é obrigatória.');
    }

    const current = untracked(this.activeCaptures);
    if (current.has(normalizedSource) === active) {
      return;
    }

    const next = new Set(current);
    if (active) {
      next.add(normalizedSource);
    } else {
      next.delete(normalizedSource);
    }
    this.activeCaptures.set(next);
  }
}
