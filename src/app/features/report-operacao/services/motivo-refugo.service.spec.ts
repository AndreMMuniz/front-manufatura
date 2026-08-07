import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MotivoRefugoService } from './motivo-refugo.service';

describe('MotivoRefugoService', () => {
  const service = new MotivoRefugoService();

  it('filters scrap reasons by code, description or partial text', async () => {
    await expect(firstValueFrom(service.buscarMotivos('05'))).resolves.toEqual([
      { codigo: '05', descricao: 'Borra' },
    ]);
    await expect(firstValueFrom(service.buscarMotivos('varr'))).resolves.toEqual([
      { codigo: '32', descricao: 'Varredura' },
    ]);
    await expect(firstValueFrom(service.buscarMotivos('setup'))).resolves.toEqual([
      { codigo: '35', descricao: 'Setup' },
      { codigo: '41', descricao: 'Setup de maquina' },
    ]);
  });
});
