import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EquipesService } from '../../equipes/services/equipes.service';
import { WorkCenterService } from './work-center';
import { ProductionContextCatalogService } from './production-context-catalog.service';

describe('ProductionContextCatalogService', () => {
  it('centraliza Área, CT ativo e responsáveis com identidade composta e cópias defensivas', async () => {
    const workCenter = {
      code: 'CT-EXT-01',
      description: 'Extrusão',
      areaCode: '4001',
      area: 'Produção',
      machineGroup: 'Extrusoras',
      establishment: '101',
      active: true,
    };
    const workCenters = { searchActiveWorkCenters: vi.fn(() => of([workCenter])) };
    const equipes = {
      listarOperadores: vi.fn(() => of([
        { codigo: ' op-001 ', nome: 'Ana' },
        { codigo: 'OP-001', nome: 'Ana duplicada' },
      ])),
      listarEquipesElegiveis: vi.fn(() => of([
        { codigo: ' eq-01 ', descricao: 'Equipe A', turno: '1', operadores: [] },
      ])),
    };
    TestBed.configureTestingModule({
      providers: [
        ProductionContextCatalogService,
        { provide: WorkCenterService, useValue: workCenters },
        { provide: EquipesService, useValue: equipes },
      ],
    });
    const service = TestBed.inject(ProductionContextCatalogService);

    const firstAreas = await firstValueFrom(service.listarAreas());
    const secondAreas = await firstValueFrom(service.listarAreas());
    const centers = await firstValueFrom(service.pesquisarCentros('4001', 'ext'));
    const responsaveis = await firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01'));

    expect(firstAreas).toEqual([
      { code: '4001', description: 'Produção' },
      { code: '4002', description: 'Qualidade' },
    ]);
    expect(firstAreas).not.toBe(secondAreas);
    expect(centers).toEqual([workCenter]);
    expect(centers[0]).not.toBe(workCenter);
    expect(responsaveis).toEqual([
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana duplicada' },
      { tipo: 'EQUIPE', codigo: 'EQ-01', nome: 'Equipe A' },
    ]);
  });

  it('não consulta responsáveis sem o par Área/CT', async () => {
    const equipes = {
      listarOperadores: vi.fn(),
      listarEquipesElegiveis: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        ProductionContextCatalogService,
        { provide: WorkCenterService, useValue: { searchActiveWorkCenters: vi.fn() } },
        { provide: EquipesService, useValue: equipes },
      ],
    });

    await expect(firstValueFrom(
      TestBed.inject(ProductionContextCatalogService).listarResponsaveis('', 'CT-EXT-01'),
    )).resolves.toEqual([]);
    expect(equipes.listarOperadores).not.toHaveBeenCalled();
  });
});
