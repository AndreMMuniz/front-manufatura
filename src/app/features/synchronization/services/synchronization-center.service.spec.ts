import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { SynchronizationCenterService } from './synchronization-center.service';

describe('SynchronizationCenterService', () => {
  it('limpa imediatamente e ignora refresh obsoleto após troca de owner', async () => {
    const ownerOnePage = deferred<ReturnType<typeof page>>();
    const outbox = {
      listPage: vi.fn(({ ownerId }: { ownerId: string }) =>
        ownerId === 'owner-1' ? ownerOnePage.promise : Promise.resolve(page('owner-2'))),
      summarizeOwner: vi.fn((ownerId: string) => Promise.resolve({
        pending: ownerId === 'owner-2' ? 1 : 0,
        error: 0,
        syncing: 0,
        receipts: 0,
      })),
    } as unknown as OutboxRepository;
    const auth = new AuthSessionService(null);
    const service = new SynchronizationCenterService(outbox, auth, true);

    auth.startSession(user('owner-1'), 'token-1');
    await tick();
    auth.startSession(user('owner-2'), 'token-2');

    expect(service.snapshot).toMatchObject({ ownerId: 'owner-2', items: [] });
    await tick();
    expect(service.snapshot.items.map(item => item.ownerId)).toEqual(['owner-2']);

    ownerOnePage.resolve(page('owner-1'));
    await tick();
    expect(service.snapshot.items.map(item => item.ownerId)).toEqual(['owner-2']);
    service.ngOnDestroy();
  });

  it('combina filtros derivados antes do corte e pagina usando o cursor retornado', async () => {
    const outbox = {
      listPage: vi.fn().mockResolvedValue(page('owner-1')),
      summarizeOwner: vi.fn().mockResolvedValue({
        pending: 1,
        error: 0,
        syncing: 0,
        receipts: 0,
      }),
    } as unknown as OutboxRepository;
    const auth = new AuthSessionService(null);
    auth.startSession(user('owner-1'), 'token');
    const service = new SynchronizationCenterService(outbox, auth, true);

    service.setFilters({
      statuses: ['PENDING'],
      modules: ['OPERATION'],
      identification: 'op 100',
    });
    await tick();

    expect(outbox.listPage).toHaveBeenLastCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      statuses: ['PENDING'],
      matchesIdentification: expect.any(Function),
    }));
    expect(service.snapshot.counts).toEqual({
      pending: 1,
      error: 0,
      syncing: 0,
      receipts: 0,
    });
    service.ngOnDestroy();
  });

  it('não consulta IndexedDB nem inicia monitoramento no SSR', async () => {
    const outbox = {
      listPage: vi.fn(),
      summarizeOwner: vi.fn(),
    } as unknown as OutboxRepository;
    const auth = new AuthSessionService(null);
    auth.startSession(user('owner-1'), 'token');

    const service = new SynchronizationCenterService(outbox, auth, false);
    await service.refresh();

    expect(outbox.listPage).not.toHaveBeenCalled();
    expect(outbox.summarizeOwner).not.toHaveBeenCalled();
    expect(service.snapshot).toMatchObject({ ownerId: null, items: [] });
  });
});

function page(ownerId = 'owner-1') {
  return {
    items: [{
      localId: `local-${ownerId}`,
      idempotencyKey: `key-${ownerId}`,
      payloadSchemaVersion: 1,
      aggregateType: 'OPERATION',
      aggregateId: 'op-100',
      commandType: 'START_OPERATION',
      payload: { ordem: '100', op: '10', split: '1' },
      canonicalPayload: '{}',
      payloadHash: 'hash',
      ownerId,
      status: 'PENDING' as const,
      dependencyIds: [],
      attemptCount: 0,
      occurredAt: '2026-07-30T12:00:00.000Z',
      createdAt: '2026-07-30T12:00:01.000Z',
      updatedAt: '2026-07-30T12:00:01.000Z',
    }],
    nextCursor: null,
    hasMore: false,
  };
}

function user(id: string) {
  return { id, nome: id, login: id, permissoes: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}
