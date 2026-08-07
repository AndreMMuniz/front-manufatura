import { describe, expect, it } from 'vitest';

import { AuthSessionService } from '../../auth/auth-session.service';
import { OperationalCorrectionContextService } from './operational-correction-context.service';

describe('OperationalCorrectionContextService', () => {
  it('mantém draft efêmero owner-scoped e limpa imediatamente na troca de sessão', () => {
    const auth = new AuthSessionService(null);
    auth.startSession(user('owner-1'), 'token-1');
    const context = new OperationalCorrectionContextService(auth);

    expect(context.activate({
      ownerId: 'owner-1',
      sourceLocalId: 'original',
      commandType: 'CREATE_STOP',
      aggregateType: 'STOPPAGE',
      aggregateId: 'stop-1',
      payloadSchemaVersion: 1,
      draft: { reason: { id: 10 } },
    })).toBe(true);
    expect(context.current('owner-1')).toMatchObject({
      sourceLocalId: 'original',
      draft: { reason: { id: 10 } },
    });

    auth.startSession(user('owner-2'), 'token-2');
    expect(context.current('owner-1')).toBeNull();
    expect(context.current('owner-2')).toBeNull();
  });
});

function user(id: string) {
  return { id, nome: id, login: id, permissoes: [] };
}
