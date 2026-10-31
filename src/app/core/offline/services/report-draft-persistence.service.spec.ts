import { describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import { ReportDraftPersistence } from './report-draft-persistence.service';

describe('ReportDraftPersistence', () => {
  it('restores after reconstruction, isolates owner/company/context and clears on confirmation', async () => {
    const storage = new Map<string, string>();
    const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } as unknown as Storage;
    const auth = { currentUser: { id: 'owner' }, mode: 'ONLINE' as 'ONLINE' | 'OFFLINE' };
    const make = (company = '1') => new ReportDraftPersistence(auth as never, { get: () => of({ companyId: company }) } as never, adapter);
    const draft = { motivos: [{ codigo: '01', quantidadeRetrabalho: 5, quantidadeRefugo: 2 }], quantidadeAprovada: 100 };
    expect(await make().write('area|ct|ordem|op|split', draft)).toBe(true);
    expect(await make().read('area|ct|ordem|op|split')).toEqual(draft);
    auth.mode = 'OFFLINE';
    expect(await make().read('area|ct|ordem|op|split')).toEqual(draft);
    auth.mode = 'ONLINE';
    expect(await make().read('area|other-ct|ordem|op|split')).toBeNull();
    expect(await make('2').read('area|ct|ordem|op|split')).toBeNull();
    auth.currentUser.id = 'other-owner';
    expect(await make().read('area|ct|ordem|op|split')).toBeNull();
    auth.currentUser.id = 'owner';
    await make().write('area|ct|ordem|op|split', null);
    expect(await make().read('area|ct|ordem|op|split')).toBeNull();
  });
  it('does not allow an earlier asynchronous save to resurrect a discarded draft', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } as unknown as Storage;
    const service = new ReportDraftPersistence({ currentUser: { id: 'a' } } as never, { get: () => of({ companyId: '1' }) } as never, storage);
    await Promise.all([service.write('batch-a', { quantidadeRefugo: 1 }), service.write('batch-a', null)]);
    expect(await service.read('batch-a')).toBeNull();
  });
  it('restores an active session before the first report and clears its locator on ending', async () => {
    const storage = new Map<string, string>();
    const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } as unknown as Storage;
    const make = () => new ReportDraftPersistence({ currentUser: { id: 'operator' } } as never, { get: () => of({ companyId: '1' }) } as never, adapter);
    const snapshot = { batchId: 'existing-batch', inicio: { iniciadoEm: '2026-10-31T10:00:00Z' }, history: [], composition: [{ id: 'order|item|op|split' }] };
    await make().saveActive('batch', 'area|ct|existing-batch', snapshot);
    expect(await make().readActive('batch')).toEqual(snapshot);
    await make().clearActive('batch');
    expect(await make().readActive('batch')).toBeNull();
  });
});
