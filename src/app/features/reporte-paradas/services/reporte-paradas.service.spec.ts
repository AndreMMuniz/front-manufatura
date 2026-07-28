import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import { ProductionContext, StopReason } from '../models/reporte-paradas.model';
import { ReporteParadasService } from './reporte-paradas.service';

describe('ReporteParadasService', () => {
  const center = {
    code: 'CT-EXT-01',
    description: 'Extrusão',
    areaCode: '4001',
    area: 'Produção',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
  const reason: StopReason = { id: 2, code: '02', description: 'Almoço' };
  const context: ProductionContext = {
    area: { code: '4001', description: 'Produção' },
    workCenter: center,
    origin: {
      type: 'OPERATION_REPORT',
      sourceRoute: '/operation-reporting',
      reportId: '450001-OP-10458-01',
    },
    preferredResponsible: { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
    metadata: { shift: '1º Turno', machineGroup: 'Extrusoras' },
  };

  function setup() {
    const catalog = {
      listarAreas: vi.fn(() => of([{ code: '4001', description: 'Produção' }])),
      pesquisarCentros: vi.fn(() => of([center])),
      listarResponsaveis: vi.fn(() => of([
        { tipo: 'OPERADOR' as const, codigo: 'OP-001', nome: 'Ana Silva' },
      ])),
    };
    TestBed.configureTestingModule({
      providers: [
        ReporteParadasService,
        { provide: ProductionContextCatalogService, useValue: catalog },
      ],
    });
    return { service: TestBed.inject(ReporteParadasService), catalog };
  }

  it('delega Área, CT e responsáveis à fronteira operacional compartilhada', async () => {
    const { service, catalog } = setup();

    const areas = await firstValueFrom(service.listarAreas());
    const centers = await firstValueFrom(service.pesquisarCentros('4001'));
    const responsaveis = await firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01'));

    expect(catalog.listarAreas).toHaveBeenCalledOnce();
    expect(catalog.pesquisarCentros).toHaveBeenCalledWith('4001', '');
    expect(catalog.listarResponsaveis).toHaveBeenCalledWith('4001', 'CT-EXT-01');
    expect(areas).toEqual([{ code: '4001', description: 'Produção' }]);
    expect(centers).toEqual([center]);
    expect(responsaveis).toEqual([
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
    ]);
  });

  it('mantém motivos mockados exclusivamente no service e devolve cópias defensivas', async () => {
    const { service } = setup();

    const first = await firstValueFrom(service.listarMotivos('4001', 'CT-EXT-01'));
    const second = await firstValueFrom(service.listarMotivos('4001', 'CT-EXT-01'));

    expect(first).toContainEqual(reason);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('propaga falha do catálogo e não a converte em lista vazia', async () => {
    const { service, catalog } = setup();
    catalog.listarResponsaveis.mockReturnValueOnce(
      throwError(() => new Error('Catálogo indisponível')),
    );

    await expect(firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01')))
      .rejects.toThrow('Catálogo indisponível');
  });

  it('preserva e devolve prefill tipado por cópia profunda', () => {
    const { service } = setup();
    service.setPrefillContext(context);

    const first = service.getPrefillContext();
    const second = service.getPrefillContext();

    expect(first).toEqual(context);
    expect(first).not.toBe(context);
    expect(first?.area).not.toBe(context.area);
    expect(first?.workCenter).not.toBe(context.workCenter);
    expect(first).not.toBe(second);
  });

  it('limpa o prefill sem apagar registros confirmados', () => {
    const { service } = setup();
    service.setPrefillContext(context);

    service.clearPrefillContext();

    expect(service.getPrefillContext()).toBeNull();
  });
});
