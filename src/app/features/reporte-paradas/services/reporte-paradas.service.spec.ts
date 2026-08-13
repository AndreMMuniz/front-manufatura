import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductionContextCatalogService } from '../../shop-floor/services/production-context-catalog.service';
import { AuthSessionService } from '../../../core/auth/auth-session.service';
import { AuthenticatedApiService } from '../../../core/http/authenticated-api.service';
import { LocalRecordRepository } from '../../../core/offline/repositories/local-record.repository';
import { OutboxRepository } from '../../../core/offline/repositories/outbox.repository';
import { OperationalCommandFacade } from '../../../core/offline/services/operational-command.facade';
import {
  CreateStopRequest,
  FinishStopRequest,
  StopResponse,
} from '../interfaces/reporte-paradas.dto';
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
  const apiReasons: ReadonlyArray<StopReason> = [
    { id: 1, code: '01', description: 'Setup' },
    reason,
  ];
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
    const captured = new Map<string, { readonly fingerprint: string; readonly result: object }>();
    const durableRecords: Array<Record<string, unknown>> = [];
    const durableOutbox: Array<Record<string, unknown>> = [];
    const authSession: { currentUser: { id: string } | null } = {
      currentUser: { id: 'operator-1' },
    };
    const catalog = {
      listarAreas: vi.fn(() => of([{ code: '4001', description: 'Produção' }])),
      pesquisarCentros: vi.fn(() => of([center])),
      listarResponsaveis: vi.fn(() =>
        of([{ tipo: 'OPERADOR' as const, codigo: 'OP-001', nome: 'Ana Silva' }]),
      ),
    };
    const localRecords = {
      listByOwner: vi.fn(async () => structuredClone(durableRecords)),
      getById: vi.fn(async (_ownerId: string, localId: string) =>
        structuredClone(durableRecords.find((record) => record['localId'] === localId) ?? null)),
      getByIdempotencyKey: vi.fn(async (_ownerId: string, key: string) =>
        structuredClone(durableRecords.find((record) => record['idempotencyKey'] === key) ?? null)),
    };
    const outbox = {
      listByOwner: vi.fn(async () => structuredClone(durableOutbox)),
      getById: vi.fn(async (_ownerId: string, localId: string) =>
        structuredClone(durableOutbox.find((entry) => entry['localId'] === localId) ?? null)),
    };
    const commands = {
      capture: vi.fn(async (request: {
        aggregateId: string;
        businessStatus: string;
        commandType: string;
        dependencyIds?: readonly string[];
        idempotencyKey?: string;
        occurredAt?: string;
        payload?: unknown;
      }) => {
        const key = request.idempotencyKey ?? globalThis.crypto.randomUUID();
        const fingerprint = JSON.stringify(request.payload);
        const prior = captured.get(key);
        if (prior && prior.fingerprint !== fingerprint) {
          throw new Error('A chave de idempotência já foi usada com outro conteúdo.');
        }
        const result = prior?.result ?? {
          localId: key,
          aggregateId: request.aggregateId,
          idempotencyKey: key,
          payloadHash: 'hash',
          committedAt: '2026-07-30T12:00:00.000Z',
          syncStatus: 'PENDING',
        };
        if (!prior) {
          const persisted = {
            localId: key,
            idempotencyKey: key,
            aggregateId: request.aggregateId,
            aggregateType: 'STOP',
            commandType: request.commandType,
            payload: structuredClone(request.payload),
            ownerId: authSession.currentUser?.id ?? '',
            businessStatus: request.businessStatus,
            dependencyIds: [...(request.dependencyIds ?? [])],
            deliveryDisposition: 'ACTIVE',
          };
          durableRecords.push(persisted);
          durableOutbox.push({ ...persisted, status: 'PENDING' });
        }
        captured.set(key, { fingerprint, result });
        return result;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        ReporteParadasService,
        { provide: ProductionContextCatalogService, useValue: catalog },
        {
          provide: AuthSessionService,
          useValue: authSession,
        },
        {
          provide: LocalRecordRepository,
          useValue: localRecords,
        },
        {
          provide: OutboxRepository,
          useValue: outbox,
        },
        {
          provide: OperationalCommandFacade,
          useValue: commands,
        },
        {
          provide: AuthenticatedApiService,
          useValue: { get: vi.fn(() => of(apiReasons)) },
        },
      ],
    });
    return {
      service: TestBed.inject(ReporteParadasService),
      catalog,
      localRecords,
      outbox,
      commands,
      authSession,
      durableRecords,
      durableOutbox,
    };
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
    expect(responsaveis).toEqual([{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }]);
  });

  it('representa bloqueio de autenticação no contrato de resposta', () => {
    const response: StopResponse = {
      id: 1,
      idempotencyKey: 'idem-1',
      status: 'EM_ANDAMENTO',
      syncStatus: 'BLOCKED_AUTH',
    };

    expect(response.syncStatus).toBe('BLOCKED_AUTH');
  });

  it('carrega motivos pela API e devolve cópias defensivas', async () => {
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

    await expect(firstValueFrom(service.listarResponsaveis('4001', 'CT-EXT-01'))).rejects.toThrow(
      'Catálogo indisponível',
    );
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

  it('limpa o prefill explicitamente', () => {
    const { service } = setup();
    service.setPrefillContext(context);

    service.clearPrefillContext();

    expect(service.getPrefillContext()).toBeNull();
  });

  it('não entrega a outra sessão o prefill criado pelo owner anterior', () => {
    const { service, authSession } = setup();
    service.setPrefillContext(context);

    authSession.currentUser = { id: 'operator-2' };

    expect(service.getPrefillContext()).toBeNull();
  });

  it('registra parada em andamento sem inventar fim', async () => {
    const { service } = setup();

    const parada = await firstValueFrom(
      service.registrarParada(
        request({
          endDate: null,
          endTime: '',
        }),
      ),
    );

    expect(parada.status).toBe('EM_ANDAMENTO');
    expect(parada.endDate).toBeUndefined();
    expect(parada.endTime).toBeUndefined();
    expect(parada.durationMinutes).toBeUndefined();
    expect(parada.syncStatus).toBe('PENDING');
    expect(parada.programmed).toBe(true);
  });

  it('registra parada finalizada e deriva duração, permitindo fim igual ao início', async () => {
    const { service } = setup();

    const finalizada = await firstValueFrom(service.registrarParada(request()));
    const instantanea = await firstValueFrom(
      service.registrarParada(
        request({
          idempotencyKey: 'idem-equal',
          endTime: '08:00',
        }),
      ),
    );

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

    await expect(
      firstValueFrom(service.registrarParada(request({ reasonId: 999 }))),
    ).rejects.toThrow('motivo');
    await expect(
      firstValueFrom(service.registrarParada(request({ areaCode: '' }))),
    ).rejects.toThrow('Área');
    catalog.listarResponsaveis.mockReturnValueOnce(of([]));
    await expect(firstValueFrom(service.registrarParada(request()))).rejects.toThrow('responsável');
  });

  it('normaliza identidade composta do responsável', async () => {
    const { service } = setup();

    const parada = await firstValueFrom(
      service.registrarParada(
        request({
          responsible: { tipo: 'OPERADOR', codigo: ' op-001 ', nome: 'Nome não canônico' },
        }),
      ),
    );

    expect(parada.responsible).toEqual({
      tipo: 'OPERADOR',
      codigo: 'OP-001',
      nome: 'Ana Silva',
    });
  });

  it('preserva os metadados recebidos no contexto da parada', async () => {
    const { service } = setup();
    const command: CreateStopRequest = {
      ...request(),
      metadata: context.metadata,
    };

    const parada = await firstValueFrom(service.registrarParada(command));

    expect(parada.context.metadata).toEqual({
      shift: '1º Turno',
      machineGroup: 'Extrusoras',
    });
  });

  it('reutiliza resultado para a mesma chave e conteúdo e rejeita conteúdo divergente', async () => {
    const { service } = setup();
    const command = request();

    const first = await firstValueFrom(service.registrarParada(command));
    const retry = await firstValueFrom(service.registrarParada({ ...command }));

    expect(retry).toEqual(first);
    expect(retry).not.toBe(first);
    await expect(
      firstValueFrom(
        service.registrarParada({
          ...command,
          programmed: false,
        }),
      ),
    ).rejects.toThrow('outro conteúdo');
  });

  it('revalida na fachada central conteúdo divergente de uma chave já persistida', async () => {
    const { service, localRecords, commands } = setup();
    localRecords.getByIdempotencyKey.mockResolvedValueOnce({
      commandType: 'CREATE_STOP',
      idempotencyKey: 'idem-1',
      payload: {
        localId: 'idem-1',
        context,
        reason: { id: 1, code: '01', description: 'Setup' },
        responsible: { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
        startDate: '2026-07-28',
        startTime: '08:00',
        endDate: '2026-07-28',
        endTime: '09:30',
        programmed: true,
        status: 'FINALIZADA',
        durationMinutes: 90,
      },
    });
    commands.capture.mockRejectedValueOnce(
      new Error('A chave de idempotência já foi usada com outro conteúdo.'),
    );

    await expect(
      firstValueFrom(
        service.registrarParada(
          request({
            programmed: false,
          }),
        ),
      ),
    ).rejects.toThrow('outro conteúdo');
    expect(commands.capture).toHaveBeenCalledOnce();
  });

  it('bloqueia comando concorrente e libera o retry após erro', async () => {
    const { service, catalog } = setup();
    const pending = new Subject<
      Array<{
        tipo: 'OPERADOR';
        codigo: string;
        nome: string;
      }>
    >();
    catalog.listarResponsaveis.mockReturnValueOnce(pending);
    const first = firstValueFrom(service.registrarParada(request()));

    await expect(
      firstValueFrom(service.registrarParada(request({ idempotencyKey: 'idem-2' }))),
    ).rejects.toThrow('andamento');

    pending.error(new Error('falha temporária'));
    await expect(first).rejects.toThrow('falha temporária');
    await expect(firstValueFrom(service.registrarParada(request()))).resolves.toEqual(
      expect.objectContaining({ idempotencyKey: 'idem-1' }),
    );
  });

  it('mantém o registro confirmado associado ao owner que iniciou o comando', async () => {
    const { service, commands, authSession, localRecords } = setup();
    let confirmCapture!: (confirmation: {
      localId: string;
      idempotencyKey: string;
      payloadHash: string;
      committedAt: string;
      syncStatus: 'PENDING';
    }) => void;
    commands.capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirmCapture = resolve;
        }),
    );
    const pending = firstValueFrom(
      service.registrarParada(
        request({
          endDate: null,
          endTime: null,
        }),
      ),
    );
    await vi.waitFor(() => expect(commands.capture).toHaveBeenCalledOnce());

    authSession.currentUser = { id: 'operator-2' };
    confirmCapture({
      localId: 'idem-1',
      idempotencyKey: 'idem-1',
      payloadHash: 'hash',
      committedAt: '2026-07-30T12:00:00.000Z',
      syncStatus: 'PENDING',
    });
    await pending;

    localRecords.listByOwner.mockResolvedValueOnce([]);
    await expect(
      firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01')),
    ).resolves.toEqual([]);
  });

  it('consulta somente paradas em andamento do contexto e devolve cópias', async () => {
    const { service } = setup();
    const aberta = await firstValueFrom(
      service.registrarParada(
        request({
          idempotencyKey: 'inicio-aberta',
          endDate: null,
          endTime: null,
        }),
      ),
    );
    await firstValueFrom(
      service.registrarParada(
        request({
          idempotencyKey: 'inicio-finalizada',
        }),
      ),
    );

    const first = await firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01'));
    const second = await firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01'));

    expect(first).toEqual([aberta]);
    expect(first[0]).not.toBe(aberta);
    expect(second[0]).not.toBe(first[0]);
    expect(await firstValueFrom(service.listarParadasEmAndamento('4002', 'CT-EXT-01'))).toEqual([]);
  });

  it('remove cache vazio e ignora comandos abandonados ou supersedidos na reconstrução', async () => {
    const { service, durableRecords, durableOutbox } = setup();
    await firstValueFrom(service.registrarParada(request({ endDate: null, endTime: null })));
    expect(await firstValueFrom(
      service.listarParadasEmAndamento('4001', 'CT-EXT-01'),
    )).toHaveLength(1);

    durableRecords[0]['deliveryDisposition'] = 'ABANDONED';
    durableOutbox[0]['deliveryDisposition'] = 'ABANDONED';
    expect(await firstValueFrom(
      service.listarParadasEmAndamento('4001', 'CT-EXT-01'),
    )).toEqual([]);

    durableRecords.splice(0);
    durableOutbox.splice(0);
    expect(await firstValueFrom(
      service.listarParadasEmAndamento('4001', 'CT-EXT-01'),
    )).toEqual([]);
  });

  it('restaura o status corrente da Outbox', async () => {
    const { service, durableOutbox } = setup();
    await firstValueFrom(service.registrarParada(request({ endDate: null, endTime: null })));
    durableOutbox[0]['status'] = 'ERROR';

    const [restored] = await firstValueFrom(
      service.listarParadasEmAndamento('4001', 'CT-EXT-01'),
    );

    expect(restored.syncStatus).toBe('ERROR');
  });

  it('rejeita troca de owner antes do commit', async () => {
    const { service, catalog, authSession, commands } = setup();
    const responsibles = new Subject<
      Array<{ tipo: 'OPERADOR'; codigo: string; nome: string }>
    >();
    catalog.listarResponsaveis.mockReturnValueOnce(responsibles);
    const pending = firstValueFrom(service.registrarParada(request()));

    authSession.currentUser = { id: 'operator-2' };
    responsibles.next([{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }]);
    responsibles.complete();

    await expect(pending).rejects.toThrow('sessão mudou');
    expect(commands.capture).not.toHaveBeenCalled();
  });

  it('finaliza por cópia e remove a parada da consulta de abertas', async () => {
    const { service } = setup();
    const aberta = await firstValueFrom(
      service.registrarParada(
        request({
          idempotencyKey: 'inicio-aberta',
          endDate: null,
          endTime: null,
        }),
      ),
    );
    await firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01'));

    const finalizada = await firstValueFrom(service.finalizarParada(aberta.id, finishRequest()));

    expect(finalizada).toEqual(
      expect.objectContaining({
        id: aberta.id,
        status: 'FINALIZADA',
        endDate: new Date(2026, 6, 28),
        endTime: '09:30',
        durationMinutes: 90,
        syncStatus: 'PENDING',
      }),
    );
    expect(finalizada).not.toBe(aberta);
    expect(await firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01'))).toEqual([]);
  });

  it('consulta idempotência do fim antes do status e detecta conflito de conteúdo', async () => {
    const { service, localRecords, outbox } = setup();
    const aberta = await firstValueFrom(
      service.registrarParada(
        request({
          idempotencyKey: 'inicio-aberta',
          endDate: null,
          endTime: null,
        }),
      ),
    );
    await firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01'));
    const command = finishRequest();

    const first = await firstValueFrom(service.finalizarParada(aberta.id, command));
    localRecords.listByOwner.mockResolvedValueOnce([]);
    outbox.listByOwner.mockResolvedValueOnce([]);
    await firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01'));
    const retry = await firstValueFrom(service.finalizarParada(aberta.id, command));

    expect(retry).toEqual(first);
    expect(retry).not.toBe(first);
    await expect(
      firstValueFrom(
        service.finalizarParada(aberta.id, {
          ...command,
          endTime: '09:31',
        }),
      ),
    ).rejects.toThrow('outro conteúdo');
  });

  it('mantém o agregado original ao finalizar criação supersessora', async () => {
    const { service, commands, durableRecords, durableOutbox } = setup();
    const creation = {
      localId: 'replacement-local-id',
      idempotencyKey: 'replacement-idempotency',
      aggregateId: 'original-stop-aggregate',
      aggregateType: 'STOP',
      commandType: 'CREATE_STOP',
      ownerId: 'operator-1',
      dependencyIds: [],
      deliveryDisposition: 'ACTIVE',
      payload: {
        localId: 'form-generated-id',
        context,
        reason: { id: 1, code: '01', description: 'Setup' },
        responsible: { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
        startDate: '2026-07-28',
        startTime: '08:00',
        endDate: null,
        endTime: null,
        programmed: false,
        status: 'EM_ANDAMENTO',
        durationMinutes: null,
      },
    };
    durableRecords.push(creation);
    durableOutbox.push({ ...creation, status: 'ERROR' });
    const [open] = await firstValueFrom(
      service.listarParadasEmAndamento('4001', 'CT-EXT-01'),
    );

    await firstValueFrom(service.finalizarParada(open.id, finishRequest()));

    expect(commands.capture).toHaveBeenLastCalledWith(expect.objectContaining({
      commandType: 'FINISH_STOP',
      aggregateId: 'original-stop-aggregate',
      dependencyIds: ['replacement-local-id'],
    }));
  });

  it('revalida contexto, estado e intervalo para comandos de fim ainda não registrados', async () => {
    const { service } = setup();
    const aberta = await firstValueFrom(
      service.registrarParada(
        request({
          idempotencyKey: 'inicio-aberta',
          endDate: null,
          endTime: null,
        }),
      ),
    );

    await firstValueFrom(service.listarParadasEmAndamento('4002', 'CT-EXT-01'));
    await expect(
      firstValueFrom(service.finalizarParada(aberta.id, finishRequest())),
    ).rejects.toThrow('contexto');

    await firstValueFrom(service.listarParadasEmAndamento('4001', 'CT-EXT-01'));
    await expect(
      firstValueFrom(
        service.finalizarParada(
          aberta.id,
          finishRequest({ endTime: '07:59', idempotencyKey: 'fim-anterior' }),
        ),
      ),
    ).rejects.toThrow('anterior');
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

  function finishRequest(overrides: Partial<FinishStopRequest> = {}): FinishStopRequest {
    return {
      endDate: '2026-07-28',
      endTime: '09:30',
      idempotencyKey: 'fim-1',
      ...overrides,
    };
  }
});
