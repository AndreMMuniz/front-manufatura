import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { WorkCenterService } from './work-center';

describe('WorkCenterService', () => {
  const centers = [{
    code: 'CT-EXT-01', description: 'Extrusão Linha 01', areaCode: '4001',
    area: 'Produção', machineGroup: 'Extrusoras', establishment: '101', active: true,
  }];

  it('loads active work centers through the API', async () => {
    const get = vi.fn().mockReturnValue(of(centers));
    const service = new WorkCenterService(
      { get } as unknown as AuthenticatedApiService,
    );

    await expect(firstValueFrom(service.listWorkCenters())).resolves.toEqual(centers);
    await firstValueFrom(service.searchActiveWorkCenters('4001', 'EXT'));

    expect(get).toHaveBeenNthCalledWith(1, '/api/work-centers', { active: true });
    expect(get).toHaveBeenNthCalledWith(2, '/api/work-centers', {
      areaCode: '4001', term: 'ext', active: true,
    });
  });

  it('selects the exact active center and clears it on logout', async () => {
    const session = new BehaviorSubject<unknown>({ user: { id: '1' } });
    const service = new WorkCenterService(
      { get: vi.fn().mockReturnValue(of(centers)) } as unknown as AuthenticatedApiService,
      { session$: session.asObservable() } as unknown as AuthSessionService,
    );

    await expect(firstValueFrom(service.selectWorkCenter('CT-EXT-01'))).resolves.toEqual(centers[0]);
    expect(service.selectedWorkCenter).toEqual(centers[0]);
    session.next(null);
    expect(service.selectedWorkCenter).toBeNull();
  });
});
