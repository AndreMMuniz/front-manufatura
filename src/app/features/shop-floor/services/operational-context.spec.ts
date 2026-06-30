import { BehaviorSubject } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { Operator } from '../models/operator';
import { OperationalContext } from '../models/operational-context';
import { WorkCenter } from '../models/work-center';
import { OperationalContextService } from './operational-context';

describe('OperationalContextService', () => {
  const workCenter: WorkCenter = {
    code: 'CT-EXT-01',
    description: 'Extrusao Linha 01',
    area: 'Producao',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
  const operator: Operator = { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true };
  const context: OperationalContext = {
    workCenter,
    operator,
    reportType: 'OPERATOR',
    validity: '2026-06-30',
  };

  let service: OperationalContextService;

  beforeEach(() => {
    service = new OperationalContextService();
  });

  it('starts without an operational context', () => {
    expect(service.currentContext).toBeNull();
  });

  it('stores and exposes the current operational context', () => {
    service.setContext(context);

    expect(service.currentContext).toEqual(context);
  });

  it('clears the current operational context', () => {
    service.setContext(context);

    service.clearContext();

    expect(service.currentContext).toBeNull();
  });

  it('clears the current operational context when the auth session is cleared', () => {
    const sessionSubject = new BehaviorSubject<unknown>({
      user: { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: [] },
      token: 'token-123',
      authenticatedAt: new Date(),
    });
    service = new OperationalContextService({
      session$: sessionSubject.asObservable(),
    } as unknown as AuthSessionService);
    service.setContext(context);

    sessionSubject.next(null);

    expect(service.currentContext).toBeNull();
  });
});
