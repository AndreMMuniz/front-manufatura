import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { WorkCenterService } from './work-center';

describe('WorkCenterService', () => {
  let service: WorkCenterService;

  beforeEach(() => {
    service = new WorkCenterService();
  });

  it('returns deterministic mock work centers', async () => {
    const centers = await firstValueFrom(service.listWorkCenters());

    expect(centers.map(center => center.code)).toEqual(['CT-EXT-01', 'CT-CQ-01', 'CT-MNT-01']);
    expect(centers[0]).toMatchObject({
      code: 'CT-EXT-01',
      description: 'Extrusao Linha 01',
      area: 'Producao',
      active: true,
    });
  });

  it('searches work centers by code and description case-insensitively', async () => {
    await expect(firstValueFrom(service.searchWorkCenters('cq'))).resolves.toEqual([
      expect.objectContaining({ code: 'CT-CQ-01' }),
    ]);

    await expect(firstValueFrom(service.searchWorkCenters('extrusao'))).resolves.toEqual([
      expect.objectContaining({ code: 'CT-EXT-01' }),
    ]);
  });

  it('searches work centers with accented Portuguese input', async () => {
    await expect(firstValueFrom(service.searchWorkCenters('extrusão'))).resolves.toEqual([
      expect.objectContaining({ code: 'CT-EXT-01' }),
    ]);

    await expect(firstValueFrom(service.searchWorkCenters('produção'))).resolves.toEqual([
      expect.objectContaining({ code: 'CT-EXT-01' }),
    ]);

    await expect(firstValueFrom(service.searchWorkCenters('manutenção'))).resolves.toEqual([
      expect.objectContaining({ code: 'CT-MNT-01' }),
    ]);
  });

  it('returns every work center for an empty search term', async () => {
    const centers = await firstValueFrom(service.searchWorkCenters('   '));

    expect(centers).toHaveLength(3);
  });

  it('selects an active work center and exposes the current selection', async () => {
    const selected = await firstValueFrom(service.selectWorkCenter('CT-EXT-01'));

    expect(selected).toMatchObject({ code: 'CT-EXT-01', active: true });
    expect(service.selectedWorkCenter).toEqual(selected);
  });

  it('does not select inactive or unknown work centers', async () => {
    await expect(firstValueFrom(service.selectWorkCenter('CT-MNT-01'))).resolves.toBeNull();
    expect(service.selectedWorkCenter).toBeNull();

    await expect(firstValueFrom(service.selectWorkCenter('CT-UNKNOWN'))).resolves.toBeNull();
    expect(service.selectedWorkCenter).toBeNull();
  });

  it('clears the selected work center', async () => {
    await firstValueFrom(service.selectWorkCenter('CT-CQ-01'));

    service.clearSelection();

    expect(service.selectedWorkCenter).toBeNull();
  });

  it('clears the selected work center when the auth session is cleared', async () => {
    const sessionSubject = new BehaviorSubject<unknown>({
      user: { id: 'USR-001', nome: 'Operador Cortag', login: 'operador', permissoes: [] },
      token: 'token-123',
      authenticatedAt: new Date(),
    });
    service = new WorkCenterService({
      session$: sessionSubject.asObservable(),
    } as unknown as AuthSessionService);
    await firstValueFrom(service.selectWorkCenter('CT-CQ-01'));

    sessionSubject.next(null);

    expect(service.selectedWorkCenter).toBeNull();
  });
});
