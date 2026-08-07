import { describe, expect, it, vi } from 'vitest';

import {
  BrowserStorageManager,
  StorageHealthService,
} from './storage-health.service';

describe('StorageHealthService', () => {
  it('não toca navigator no SSR/browser incompatível', async () => {
    const service = new StorageHealthService(null);

    await service.assess();

    expect(service.state()).toEqual({ status: 'unsupported', supported: false });
  });

  it('consulta persistência, solicita quando necessário e registra quota/uso', async () => {
    const storage: BrowserStorageManager = {
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 250, quota: 1000 }),
    };
    const service = new StorageHealthService(storage);

    await service.assess();

    expect(storage.persisted).toHaveBeenCalledOnce();
    expect(storage.persist).toHaveBeenCalledOnce();
    expect(service.state()).toEqual({
      status: 'healthy',
      supported: true,
      persisted: true,
      usage: 250,
      quota: 1000,
      usageRatio: 0.25,
    });
  });

  it('representa negativa como risco sem afirmar persistência', async () => {
    const storage: BrowserStorageManager = {
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
      estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 }),
    };
    const service = new StorageHealthService(storage);

    await service.assess();

    expect(service.state()).toMatchObject({
      status: 'risk',
      supported: true,
      persisted: false,
      message: 'O navegador pode remover dados locais quando precisar liberar espaço.',
    });
  });

  it('representa quota esgotada como risco mesmo quando o storage é persistente', async () => {
    const storage: BrowserStorageManager = {
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn(),
      estimate: vi.fn().mockResolvedValue({ usage: 100, quota: 100 }),
    };
    const service = new StorageHealthService(storage);

    await service.assess();

    expect(service.state()).toMatchObject({
      status: 'risk',
      persisted: true,
      usageRatio: 1,
      message: 'O armazenamento local atingiu a quota disponível.',
    });
  });

  it('sanitiza falhas da API como risco sem expor conteúdo', async () => {
    const storage: BrowserStorageManager = {
      persisted: vi.fn().mockRejectedValue(new Error('payload secreto')),
      persist: vi.fn(),
      estimate: vi.fn(),
    };
    const service = new StorageHealthService(storage);

    await service.assess();

    expect(service.state()).toEqual({
      status: 'risk',
      supported: true,
      persisted: false,
      message: 'Não foi possível confirmar a proteção do armazenamento local.',
    });
    expect(JSON.stringify(service.state())).not.toContain('secreto');
  });
});
