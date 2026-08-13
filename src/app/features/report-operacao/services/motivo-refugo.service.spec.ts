import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { MotivoRefugoService } from './motivo-refugo.service';

describe('MotivoRefugoService', () => {
  it('loads scrap reasons from the authenticated API with the search term', async () => {
    const get = vi.fn().mockReturnValue(of([{ codigo: '35', descricao: 'Setup' }]));
    const service = new MotivoRefugoService({ get } as unknown as AuthenticatedApiService);

    await expect(firstValueFrom(service.buscarMotivos('setup'))).resolves.toEqual([
      { codigo: '35', descricao: 'Setup' },
    ]);
    expect(get).toHaveBeenCalledWith('/api/scrap-reasons', { term: 'setup' });
  });
});
