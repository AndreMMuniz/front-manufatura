import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { LocalCommandRepository } from '../../../core/offline/repositories/local-command.repository';
import {
  SYNC_UNSYNCHRONIZED_ABANDON,
  SynchronizationPermissionPolicy,
} from './synchronization-permission.policy';
import { SynchronizationAbandonmentService } from './synchronization-abandonment.service';

describe('SynchronizationAbandonmentService', () => {
  it('nega por default antes do repository e diferencia motivo inválido/segredo', async () => {
    const repository = { abandonCommand: vi.fn() } as unknown as LocalCommandRepository;
    const auth = new AuthSessionService(null);
    auth.startSession(user([]), 'token', { expiresAt: '2099-01-01T00:00:00.000Z' });
    const service = new SynchronizationAbandonmentService(
      repository,
      auth,
      new SynchronizationPermissionPolicy(false),
      () => new Date('2026-07-30T12:00:00.000Z'),
    );

    expect(await service.abandon('local-1', 'Justificativa operacional válida')).toBe('denied');
    expect(repository.abandonCommand).not.toHaveBeenCalled();

    auth.startSession(user([SYNC_UNSYNCHRONIZED_ABANDON]), 'token', { expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(await service.abandon('local-1', 'curta')).toBe('invalid-reason');
    expect(await service.abandon('local-1', 'Token: abcdefghijklmnop')).toBe('secret-detected');
    expect(repository.abandonCommand).not.toHaveBeenCalled();
    service.ngOnDestroy();
  });

  it('envia owner/ator canônico e revalida epoch da sessão no repository', async () => {
    let capturedCurrent = () => false;
    const repository = {
      abandonCommand: vi.fn(async request => {
        capturedCurrent = request.sessionIsCurrent;
        return request.sessionIsCurrent() ? 'abandoned' : 'stale-or-ineligible';
      }),
    } as unknown as LocalCommandRepository;
    const auth = new AuthSessionService(null);
    auth.startSession(user([SYNC_UNSYNCHRONIZED_ABANDON], ' owner-1 '), 'token', { expiresAt: '2099-01-01T00:00:00.000Z' });
    const service = new SynchronizationAbandonmentService(
      repository,
      auth,
      new SynchronizationPermissionPolicy(false),
      () => new Date('2026-07-30T12:00:00.000Z'),
    );

    expect(await service.abandon('local-1', '  Duplicidade confirmada na operação  ')).toBe(
      'abandoned',
    );
    expect(repository.abandonCommand).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      actorId: 'owner-1',
      permission: SYNC_UNSYNCHRONIZED_ABANDON,
      reason: 'Duplicidade confirmada na operação',
      now: '2026-07-30T12:00:00.000Z',
    }));

    auth.startSession(user([SYNC_UNSYNCHRONIZED_ABANDON], 'owner-2'), 'other', { expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(capturedCurrent()).toBe(false);
    service.ngOnDestroy();
  });

  it('consulta o impacto da cadeia somente para usuário autorizado', async () => {
    const repository = {
      abandonmentImpact: vi.fn().mockResolvedValue({ affectedCount: 2, dependentCount: 1 }),
    } as unknown as LocalCommandRepository;
    const auth = new AuthSessionService(null);
    const service = new SynchronizationAbandonmentService(
      repository,
      auth,
      new SynchronizationPermissionPolicy(false),
      () => new Date('2026-07-30T12:00:00.000Z'),
    );

    expect(await service.impact('local-1')).toBeNull();
    auth.startSession(user([SYNC_UNSYNCHRONIZED_ABANDON], ' owner-1 '), 'token', {
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(await service.impact('local-1')).toEqual({ affectedCount: 2, dependentCount: 1 });
    service.ngOnDestroy();
  });
});

function user(permissoes: string[], id = 'owner-1') {
  return { id, nome: 'Owner', login: 'owner', permissoes };
}
