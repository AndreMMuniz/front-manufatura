import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  SynchronizationCenterService,
  SynchronizationCenterState,
} from '../../services/synchronization-center.service';
import { SynchronizationCenterPage } from './synchronization-center';

describe('SynchronizationCenterPage', () => {
  it('renderiza loading, vazio, erro de leitura, indisponibilidade e nova tentativa distintos', async () => {
    const test = await setup(state({ readState: 'loading' }));

    expect(test.fixture.nativeElement.querySelector('[data-testid="sync-loading"]')).not.toBeNull();
    test.subject.next(state({ readState: 'ready' }));
    test.fixture.detectChanges();
    expect(test.fixture.nativeElement.querySelector('[data-testid="sync-empty"]')).not.toBeNull();

    test.subject.next(state({ readState: 'error', errorMessage: 'Falha local' }));
    test.fixture.detectChanges();
    expect(test.fixture.nativeElement.querySelector('[data-testid="sync-read-error"]').textContent)
      .toContain('Falha local');
    test.fixture.nativeElement.querySelector('[data-testid="sync-retry-load"]').click();
    expect(test.refresh).toHaveBeenCalledOnce();

    test.subject.next(state({ readState: 'unavailable' }));
    test.fixture.detectChanges();
    expect(test.fixture.nativeElement.querySelector('[data-testid="sync-unavailable"]'))
      .not.toBeNull();
  });

  it('mostra status de negócio e sincronização separados e detalhes allowlisted', async () => {
    const test = await setup(state({
      readState: 'ready',
      items: [item()],
      counts: { pending: 0, error: 1, syncing: 0, receipts: 0 },
    }));
    const trigger = test.fixture.nativeElement.querySelector('[data-testid="sync-detail-local-1"]');

    expect(test.fixture.nativeElement.querySelector('[data-testid="business-status-local-1"]')
      .textContent).toContain('APROVADO');
    expect(test.fixture.nativeElement.querySelector('[data-testid="sync-status-local-1"]')
      .textContent).toContain('Registro preservado');

    trigger.focus();
    trigger.click();
    test.fixture.detectChanges();
    const dialog = test.fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('OP 100');
    expect(dialog.textContent).not.toMatch(/payload|hash|secret/i);
    dialog.querySelector('[data-testid="sync-close-detail"]').click();
    test.fixture.detectChanges();
    expect(document.activeElement).toBe(trigger);
  });

  it('combina filtros e permite limpá-los com controles acessíveis', async () => {
    const test = await setup(state({ readState: 'ready', items: [item()] }));
    const identification = test.fixture.nativeElement.querySelector('#sync-identification');
    identification.value = 'OP 100';
    identification.dispatchEvent(new Event('input', { bubbles: true }));
    test.fixture.nativeElement.querySelector('[data-testid="sync-apply-filters"]').click();

    expect(test.setFilters).toHaveBeenCalledWith(expect.objectContaining({
      identification: 'OP 100',
    }));

    test.fixture.nativeElement.querySelector('[data-testid="sync-clear-filters"]').click();
    expect(test.setFilters).toHaveBeenLastCalledWith({
      statuses: [],
      modules: [],
    });
  });
});

async function setup(initial: SynchronizationCenterState) {
  const subject = new BehaviorSubject(initial);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const loadMore = vi.fn().mockResolvedValue(undefined);
  const setFilters = vi.fn();
  await TestBed.configureTestingModule({
    imports: [SynchronizationCenterPage],
    providers: [{
      provide: SynchronizationCenterService,
      useValue: {
        state$: subject.asObservable(),
        snapshot: initial,
        refresh,
        loadMore,
        setFilters,
      },
    }],
  }).compileComponents();
  const fixture = TestBed.createComponent(SynchronizationCenterPage);
  fixture.detectChanges();
  return { fixture, subject, refresh, loadMore, setFilters };
}

function state(overrides: Partial<SynchronizationCenterState> = {}): SynchronizationCenterState {
  return {
    ownerId: 'operator-1',
    readState: 'idle',
    items: [],
    counts: { pending: 0, error: 0, syncing: 0, receipts: 0 },
    filters: { statuses: [], modules: [] },
    nextCursor: null,
    hasMore: false,
    ...overrides,
  };
}

function item() {
  return {
    localId: 'local-1',
    module: 'OPERATION' as const,
    moduleLabel: 'Reporte de Operação',
    commandLabel: 'Reportar operação',
    operationalIdentification: 'OP 100 · Operação 10 · Split 1',
    occurredAt: '2026-07-30T12:00:00.000Z',
    createdAt: '2026-07-30T12:00:01.000Z',
    ownerId: 'operator-1',
    attemptCount: 2,
    lastMessage: 'Falha segura',
    correlationId: 'corr-1',
    businessStatus: 'APROVADO',
    syncStatus: 'ERROR',
    syncStatusLabel: 'Registro preservado — precisa de atenção',
    syncIcon: 'po-icon-warning',
    syncTone: 'danger' as const,
    disposition: 'ACTIVE' as const,
    recoveryPolicy: 'CORRECTABLE' as const,
    recoveryRoute: '/operation-reporting',
    availableActions: ['retry', 'correct', 'abandon'] as const,
  };
}
