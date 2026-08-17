import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  SynchronizationCenterService,
  SynchronizationCenterState,
} from '../../services/synchronization-center.service';
import { SyncCoordinatorService } from '../../../../core/offline/services/sync-coordinator.service';
import { SynchronizationRecoveryRegistry } from '../../services/synchronization-recovery-registry';
import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import {
  SYNC_UNSYNCHRONIZED_ABANDON,
  SynchronizationPermissionPolicy,
} from '../../services/synchronization-permission.policy';
import { SynchronizationAbandonmentService } from '../../services/synchronization-abandonment.service';
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

  it('destaca os quatro dados do resultado CQ ainda não enviado', async () => {
    const qualityItem = { ...item(), operationalDetails: [
      { label: 'Ordem', value: '372562' }, { label: 'Exame', value: '1845' },
      { label: 'Componente', value: '1' }, { label: 'Resultado', value: '24,01' },
    ] };
    const test = await setup(state({ readState: 'ready', items: [qualityItem] }));

    test.fixture.nativeElement.querySelector('[data-testid="sync-detail-local-1"]').click();
    test.fixture.detectChanges();
    const details = test.fixture.nativeElement.querySelector('[data-testid="sync-operational-details"]');
    expect(details.textContent).toMatch(/Ordem\s*372562/);
    expect(details.textContent).toMatch(/Exame\s*1845/);
    expect(details.textContent).toMatch(/Componente\s*1/);
    expect(details.textContent).toMatch(/Resultado\s*24,01/);
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

  it('bloqueia retry duplo, aguarda só a fila local e comunica o resultado discriminado', async () => {
    const retry = deferred<'queued'>();
    const test = await setup(state({
      readState: 'ready',
      items: [item()],
    }), retry.promise);
    const button = test.fixture.nativeElement.querySelector('[data-testid="sync-retry-local-1"]');

    button.click();
    button.click();
    test.fixture.detectChanges();
    expect(test.retryError).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);

    retry.resolve('queued');
    await test.fixture.whenStable();
    test.fixture.detectChanges();
    expect(test.fixture.nativeElement.querySelector('[data-testid="sync-action-feedback"]')
      .textContent).toContain('preparado para nova tentativa');
  });

  it('confirma cancelamento crítico com justificativa, bloqueia concorrência e devolve foco', async () => {
    const abandonment = deferred<'abandoned'>();
    const test = await setup(
      state({ readState: 'ready', items: [item()] }),
      Promise.resolve('queued'),
      abandonment.promise,
    );
    const trigger = test.fixture.nativeElement.querySelector('[data-testid="sync-abandon-local-1"]');
    expect(trigger.textContent).toContain('Cancelar sincronização');
    trigger.focus();
    trigger.click();
    test.fixture.detectChanges();
    const dialog = test.fixture.nativeElement.querySelector('[data-testid="sync-abandon-dialog"]');
    expect(dialog.textContent).toContain('Cancelar sincronização deste registro?');
    expect(dialog.textContent).toContain('não será mais enviado');
    expect(dialog.textContent).toContain('não informe senhas');

    const reason = dialog.querySelector('textarea');
    reason.value = 'Duplicidade confirmada na operação';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    const confirm = dialog.querySelector('[data-testid="sync-confirm-abandon"]');
    expect(confirm.textContent).toContain('Confirmar cancelamento');
    confirm.click();
    confirm.click();
    test.fixture.detectChanges();
    expect(test.abandon).toHaveBeenCalledOnce();
    expect(confirm.disabled).toBe(true);

    abandonment.resolve('abandoned');
    await test.fixture.whenStable();
    test.fixture.detectChanges();
    expect(test.fixture.nativeElement.querySelector('[data-testid="sync-abandon-dialog"]'))
      .toBeNull();
    expect(document.activeElement).toBe(
      test.fixture.nativeElement.querySelector('[data-testid="sync-abandon-local-1"]'),
    );
  });
});

async function setup(
  initial: SynchronizationCenterState,
  retryResult: Promise<'queued'> = Promise.resolve('queued'),
  abandonmentResult: Promise<'abandoned'> = Promise.resolve('abandoned'),
) {
  const subject = new BehaviorSubject(initial);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const loadMore = vi.fn().mockResolvedValue(undefined);
  const setFilters = vi.fn();
  const retryError = vi.fn().mockReturnValue(retryResult);
  const abandon = vi.fn().mockReturnValue(abandonmentResult);
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
    }, {
      provide: SyncCoordinatorService,
      useValue: { retryError },
    }, {
      provide: SynchronizationRecoveryRegistry,
      useValue: { openCorrection: vi.fn().mockResolvedValue('opened') },
    }, {
      provide: AuthSessionService,
      useValue: {
        currentUser: {
          id: 'operator-1',
          nome: 'Owner',
          login: 'owner',
          permissoes: [SYNC_UNSYNCHRONIZED_ABANDON],
        },
      },
    }, {
      provide: SynchronizationPermissionPolicy,
      useValue: new SynchronizationPermissionPolicy(),
    }, {
      provide: SynchronizationAbandonmentService,
      useValue: { abandon },
    }],
  }).compileComponents();
  const fixture = TestBed.createComponent(SynchronizationCenterPage);
  fixture.detectChanges();
  return { fixture, subject, refresh, loadMore, setFilters, retryError, abandon };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });
  return { promise, resolve };
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
    operationalDetails: [],
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
