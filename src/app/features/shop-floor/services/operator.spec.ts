import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { OperatorService } from './operator';

describe('OperatorService', () => {
  const operators = [
    { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
  ];

  it('loads and searches active operators through the API', async () => {
    const get = vi.fn().mockReturnValue(of(operators));
    const service = new OperatorService(
      { get } as unknown as AuthenticatedApiService,
    );

    await expect(firstValueFrom(service.listOperators())).resolves.toEqual(operators);
    await firstValueFrom(service.searchOperators('Ana'));

    expect(get).toHaveBeenNthCalledWith(1, '/api/operators', { active: true });
    expect(get).toHaveBeenNthCalledWith(2, '/api/operators', { term: 'ana', active: true });
  });

  it('selects the exact active operator and clears it on logout', async () => {
    const session = new BehaviorSubject<unknown>({ user: { id: '1' } });
    const service = new OperatorService(
      { get: vi.fn().mockReturnValue(of(operators)) } as unknown as AuthenticatedApiService,
      { session$: session.asObservable() } as unknown as AuthSessionService,
    );

    await expect(firstValueFrom(service.selectOperator('OP-001'))).resolves.toEqual(operators[0]);
    expect(service.selectedOperator).toEqual(operators[0]);
    session.next(null);
    expect(service.selectedOperator).toBeNull();
  });

  it('keeps operator selection required', () => {
    const service = new OperatorService(
      { get: vi.fn().mockReturnValue(of([])) } as unknown as AuthenticatedApiService,
    );
    expect(service.isOperatorRequired()).toBe(true);
  });
});
