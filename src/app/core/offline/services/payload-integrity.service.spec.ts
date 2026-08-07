import { describe, expect, it, vi } from 'vitest';

import { normalizeDependencyIds } from '../models/local-record';
import { OfflineStorageError } from '../models/offline-storage-error';
import {
  PayloadIntegrityService,
  provideBrowserSubtleCrypto,
} from './payload-integrity.service';

const SHA_256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('PayloadIntegrityService', () => {
  const service = new PayloadIntegrityService(() => globalThis.crypto?.subtle);

  it('ordena objetos, preserva arrays e converte datas para ISO', async () => {
    const input = {
      z: 3,
      items: [{ b: 2, a: 1 }, 'fim'],
      happenedAt: new Date('2026-07-28T12:34:56.000-03:00'),
      a: true,
    };

    const prepared = await service.prepare(input);

    expect(prepared.canonicalPayload).toBe(
      '{"a":true,"happenedAt":"2026-07-28T15:34:56.000Z","items":[{"a":1,"b":2},"fim"],"z":3}',
    );
    expect(prepared.snapshot).toEqual(JSON.parse(prepared.canonicalPayload));
    expect(Object.isFrozen(prepared.snapshot)).toBe(true);
  });

  it('produz SHA-256 hexadecimal conhecido sobre o conteúdo canônico exato', async () => {
    const hash = await service.hashCanonical('abc');

    expect(hash).toBe(SHA_256_ABC);
  });

  it.each([
    { invalid: undefined },
    { invalid: Number.NaN },
    { invalid: Number.POSITIVE_INFINITY },
    { invalid: () => undefined },
    { invalid: Symbol('invalid') },
    { invalid: new Map() },
  ])('rejeita estrutura não serializável sem expor o payload: $invalid', async ({ invalid }) => {
    await expect(service.prepare({ value: invalid })).rejects.toEqual(
      expect.objectContaining({
        code: 'PAYLOAD_INVALID',
        message: expect.not.stringContaining(String(invalid)),
      }),
    );
  });

  it('rejeita ciclos', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    await expect(service.prepare(cyclic)).rejects.toEqual(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
  });

  it.each([
    'password',
    'senhaSupervisor',
    'access_token',
    'Authorization',
    'cookieValue',
    'clientSecret',
    'credencial',
    'apiKey',
    'accessKey',
    'jwt',
    'supervisorPin',
    'privateKey',
  ])('rejeita campo sensível normalizado %s', async (field) => {
    await expect(service.prepare({ [field]: 'não deve persistir' })).rejects.toEqual(
      expect.objectContaining({ code: 'SENSITIVE_DATA' }),
    );
  });

  it('permite somente metadados de autorização explicitamente sanitizados', async () => {
    await expect(
      service.prepare({ authorizationStatus: 'APPROVED', supervisorAuthorizationId: 'auth-42' }),
    ).resolves.toEqual(expect.objectContaining({ payloadHash: expect.any(String) }));
  });

  it('rejeita credencial disfarçada em metadado de autorização allowlisted', async () => {
    await expect(
      service.prepare({ authorizationStatus: 'Bearer segredo' }),
    ).rejects.toEqual(expect.objectContaining({ code: 'SENSITIVE_DATA' }));
  });

  it('preserva uma chave própria __proto__ sem colisão canônica', async () => {
    const prepared = await service.prepare(JSON.parse('{"__proto__":{"role":"operator"}}'));

    expect(prepared.canonicalPayload).toBe('{"__proto__":{"role":"operator"}}');
    expect(prepared.snapshot).toEqual(JSON.parse(prepared.canonicalPayload));
  });

  it('rejeita arrays esparsos em vez de assinar null para um snapshot com buraco', async () => {
    await expect(service.prepare(new Array(1))).rejects.toEqual(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
  });

  it('rejeita accessors sem executar o getter nem propagar seu erro', async () => {
    const getter = vi.fn(() => {
      throw new Error('Bearer segredo');
    });
    const payload = Object.defineProperty({}, 'safe', {
      enumerable: true,
      get: getter,
    });

    await expect(service.prepare(payload)).rejects.toEqual(
      expect.objectContaining({
        code: 'PAYLOAD_INVALID',
        message: expect.not.stringContaining('segredo'),
      }),
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it('limita a profundidade e retorna erro tipado', async () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 102; depth += 1) {
      const nested: Record<string, unknown> = {};
      cursor['nested'] = nested;
      cursor = nested;
    }

    await expect(service.prepare(root)).rejects.toEqual(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
  });

  it('retorna erro tipado quando SHA-256 não está disponível', async () => {
    const unavailable = new PayloadIntegrityService(() => undefined);

    await expect(unavailable.prepare({ safe: true })).rejects.toEqual(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });

  it('não expõe Web Crypto quando window não existe no SSR', () => {
    vi.stubGlobal('window', undefined);

    expect(provideBrowserSubtleCrypto()).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('normaliza dependências preservando a primeira ordem declarada', () => {
    expect(normalizeDependencyIds([' command-a ', '', 'command-b', 'command-a'])).toEqual([
      'command-a',
      'command-b',
    ]);
  });
});
