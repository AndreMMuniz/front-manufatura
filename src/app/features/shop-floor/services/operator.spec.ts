import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { OperatorService } from './operator';

describe('OperatorService', () => {
  let service: OperatorService;

  beforeEach(() => {
    service = new OperatorService();
  });

  it('returns deterministic mock operators', async () => {
    const operators = await firstValueFrom(service.listOperators());

    expect(operators.map(operator => operator.code)).toEqual(['OP-001', 'OP-002', 'OP-003', 'OP-004']);
    expect(operators[0]).toMatchObject({
      code: 'OP-001',
      name: 'Ana Silva',
      role: 'Operador',
      active: true,
    });
  });

  it('searches operators by code and name case-insensitively', async () => {
    await expect(firstValueFrom(service.searchOperators('silva'))).resolves.toEqual([
      expect.objectContaining({ code: 'OP-001' }),
    ]);

    await expect(firstValueFrom(service.searchOperators('OP-003'))).resolves.toEqual([
      expect.objectContaining({ code: 'OP-003' }),
    ]);
  });

  it('searches operators by role', async () => {
    await expect(firstValueFrom(service.searchOperators('supervisor'))).resolves.toEqual([
      expect.objectContaining({ code: 'OP-003' }),
    ]);
  });

  it('searches operators with accented Portuguese input', async () => {
    await expect(firstValueFrom(service.searchOperators('ánã silva'))).resolves.toEqual([
      expect.objectContaining({ code: 'OP-001' }),
    ]);

    await expect(firstValueFrom(service.searchOperators('diogo souza'))).resolves.toEqual([]);
  });

  it('returns every operator for an empty search term', async () => {
    const operators = await firstValueFrom(service.searchOperators('   '));

    expect(operators).toHaveLength(4);
  });

  it('selects an active operator and exposes the current selection', async () => {
    const selected = await firstValueFrom(service.selectOperator('OP-001'));

    expect(selected).toMatchObject({ code: 'OP-001', active: true });
    expect(service.selectedOperator).toEqual(selected);
  });

  it('does not select inactive or unknown operators', async () => {
    await expect(firstValueFrom(service.selectOperator('OP-004'))).resolves.toBeNull();
    expect(service.selectedOperator).toBeNull();

    await expect(firstValueFrom(service.selectOperator('OP-UNKNOWN'))).resolves.toBeNull();
    expect(service.selectedOperator).toBeNull();
  });

  it('clears the selected operator', async () => {
    await firstValueFrom(service.selectOperator('OP-002'));

    service.clearSelection();

    expect(service.selectedOperator).toBeNull();
  });

  it('clears the selected operator when the auth session is cleared', async () => {
    const sessionSubject = new BehaviorSubject<unknown>({ user: { username: 'operador' } });
    service = new OperatorService({
      session$: sessionSubject.asObservable(),
    } as unknown as AuthSessionService);
    await firstValueFrom(service.selectOperator('OP-003'));

    sessionSubject.next(null);

    expect(service.selectedOperator).toBeNull();
  });

  it('reports operator as required by default', () => {
    expect(service.isOperatorRequired()).toBe(true);
  });
});