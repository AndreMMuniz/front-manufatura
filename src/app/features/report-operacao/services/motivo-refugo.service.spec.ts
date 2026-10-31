import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { MotivoRefugoService } from './motivo-refugo.service';

describe('MotivoRefugoService continuity', () => {
  const motivos = [{ codigo: '005', descricao: 'Borra', materialScrap: true, rework: false }];
  it('restores a previously verified catalogue when auth headers throw synchronously after reload', async () => {
    let cache: unknown = null;
    let online = true;
    const api = { get: vi.fn(() => { if (!online) throw new Error('authenticated-api-session-required'); return of(motivos); }) };
    const store = { write: async (_key: string, value: unknown) => { cache = value; return true; }, read: async () => cache };
    await expect(firstValueFrom(new MotivoRefugoService(api as never, store as never).buscarMotivos(''))).resolves.toEqual(motivos);
    online = false;
    await expect(firstValueFrom(new MotivoRefugoService(api as never, store as never).buscarMotivos(''))).resolves.toEqual(motivos);
    online = true;
    await expect(firstValueFrom(new MotivoRefugoService(api as never, store as never).buscarMotivos(''))).resolves.toEqual(motivos);
    expect(api.get).toHaveBeenCalledTimes(3);
  });
  it('surfaces missing or malformed cache instead of inventing eligibility', async () => {
    const api = { get: () => { throw new Error('no-remote-session'); } };
    for (const cache of [null, { motivos: [{ codigo: '005', descricao: 'Borra' }] }]) {
      const service = new MotivoRefugoService(api as never, { read: async () => cache } as never);
      await expect(firstValueFrom(service.buscarMotivos(''))).rejects.toThrow('no-remote-session');
    }
  });
});
