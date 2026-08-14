import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { WorkCenterService } from './work-center';
import { ProductionContextCatalogService } from './production-context-catalog.service';

describe('ProductionContextCatalogService', () => {
  it('loads areas and responsible identities from the API and delegates centers', async () => {
    const center = {
      code: 'CT-01', description: 'Centro', areaCode: '4001', area: 'Produção',
      machineGroup: 'GM', establishment: '1', active: true,
    };
    const get = vi.fn((url: string) => of(url === '/api/production-areas'
      ? [{ code: '4001', description: 'Produção' }]
      : [{ tipo: 'OPERADOR', codigo: 'op-1', nome: 'Ana' }]));
    TestBed.configureTestingModule({ providers: [
      ProductionContextCatalogService,
      { provide: AuthenticatedApiService, useValue: { get } },
      { provide: WorkCenterService, useValue: { searchActiveWorkCenters: vi.fn(() => of([center])) } },
    ] });
    const service = TestBed.inject(ProductionContextCatalogService);

    await expect(firstValueFrom(service.listarAreas())).resolves.toEqual([{ code: '4001', description: 'Produção' }]);
    await expect(firstValueFrom(service.pesquisarCentros('4001', 'centro'))).resolves.toEqual([center]);
    await expect(firstValueFrom(service.listarResponsaveis('4001', 'CT-01'))).resolves.toEqual([
      { tipo: 'OPERADOR', codigo: 'OP-1', nome: 'Ana' },
    ]);
    expect(get).toHaveBeenCalledWith('/api/operational-responsibles', {
      areaCode: '4001', workCenterCode: 'CT-01',
    });
  });

  it('does not request responsibilities without area and center', async () => {
    const get = vi.fn();
    TestBed.configureTestingModule({ providers: [
      ProductionContextCatalogService,
      { provide: AuthenticatedApiService, useValue: { get } },
      { provide: WorkCenterService, useValue: {} },
    ] });
    await expect(firstValueFrom(TestBed.inject(ProductionContextCatalogService)
      .listarResponsaveis('', 'CT-01'))).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
