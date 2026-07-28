import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import { CreateStopRequest } from '../interfaces/reporte-paradas.dto';
import { ProductionContext, StopReason } from '../models/reporte-paradas.model';
import { ReporteParadasService } from './reporte-paradas.service';

describe('ReporteParadasService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
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

  it('registra parada em andamento sem inventar fim', async () => {
    const { service } = setup();

    const parada = await firstValueFrom(service.registrarParada(request({
      endDate: null,
      endTime: '',
    })));

    expect(parada.status).toBe('EM_ANDAMENTO');
    expect(parada.endDate).toBeUndefined();
    expect(parada.endTime).toBe('');
    expect(parada.durationMinutes).toBeUndefined();
    expect(parada.syncStatus).toBe('PENDING');
    expect(parada.programmed).toBe(true);
  });

  it('registra parada finalizada e deriva duração, permitindo fim igual ao início', async () => {
    const { service } = setup();

    const finalizada = await firstValueFrom(service.registrarParada(request()));
    const instantanea = await firstValueFrom(service.registrarParada(request({
      idempotencyKey: 'idem-equal',
      endTime: '08:00',
    })));

    expect(finalizada.status).toBe('FINALIZADA');
    expect(finalizada.durationMinutes).toBe(90);
    expect(instantanea.durationMinutes).toBe(0);
  });

  it.each([
    [{ endDate: '2026-07-28', endTime: '' }, 'Data Final e Hora Final'],
    [{ endDate: null, endTime: '09:00' }, 'Data Final e Hora Final'],
    [{ startDate: 'data-inválida' }, 'Data Inicial'],
    [{ startTime: '25:00' }, 'Hora Inicial'],
    [{ endDate: 'data-inválida' }, 'Data Final'],
    [{ endTime: '9h00' }, 'Hora Final'],
    [{ endTime: '07:59' }, 'anterior'],
  ])('rejeita período inválido sem alterar o request (%s)', async (change, message) => {
    const { service } = setup();
    const command = request(change);
    const before = structuredClone(command);

    await expect(firstValueFrom(service.registrarParada(command))).rejects.toThrow(message);
    expect(command).toEqual(before);
  });

  it('valida motivo, contexto e responsável elegível', async () => {
    const { service, catalog } = setup();

    await expect(firstValueFrom(service.registrarParada(request({ reasonId: 999 }))))
      .rejects.toThrow('motivo');
    await expect(firstValueFrom(service.registrarParada(request({ areaCode: '' }))))
      .rejects.toThrow('Área');
    catalog.listarResponsaveis.mockReturnValueOnce(of([]));
    await expect(firstValueFrom(service.registrarParada(request())))
      .rejects.toThrow('responsável');
  });

  it('normaliza identidade composta do responsável', async () => {
    const { service } = setup();

    const parada = await firstValueFrom(service.registrarParada(request({
      responsible: { tipo: 'OPERADOR', codigo: ' op-001 ', nome: 'Nome não canônico' },
    })));

    expect(parada.responsible).toEqual({
      tipo: 'OPERADOR',
      codigo: 'OP-001',
      nome: 'Ana Silva',
    });
  });

  it('reutiliza resultado para a mesma chave e conteúdo e rejeita conteúdo divergente', async () => {
    const { service } = setup();
    const command = request();

    const first = await firstValueFrom(service.registrarParada(command));
    const retry = await firstValueFrom(service.registrarParada({ ...command }));

    expect(retry).toEqual(first);
    expect(retry).not.toBe(first);
    await expect(firstValueFrom(service.registrarParada({
      ...command,
      programmed: false,
    }))).rejects.toThrow('outro conteúdo');
  });

  it('bloqueia comando concorrente e libera o retry após erro', async () => {
    const { service, catalog } = setup();
    const pending = new Subject<Array<{
      tipo: 'OPERADOR';
      codigo: string;
      nome: string;
    }>>();
    catalog.listarResponsaveis.mockReturnValueOnce(pending);
    const first = firstValueFrom(service.registrarParada(request()));

    await expect(firstValueFrom(service.registrarParada(request({ idempotencyKey: 'idem-2' }))))
      .rejects.toThrow('andamento');

    pending.error(new Error('falha temporária'));
    await expect(first).rejects.toThrow('falha temporária');
    await expect(firstValueFrom(service.registrarParada(request()))).resolves.toEqual(
      expect.objectContaining({ idempotencyKey: 'idem-1' }),
    );
  });

  function request(overrides: Partial<CreateStopRequest> = {}): CreateStopRequest {
    return {
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      reasonId: 1,
      responsible: { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      startDate: '2026-07-28',
      startTime: '08:00',
      endDate: '2026-07-28',
      endTime: '09:30',
      programmed: true,
      origin: context.origin,
      idempotencyKey: 'idem-1',
      ...overrides,
    };
  }
});
