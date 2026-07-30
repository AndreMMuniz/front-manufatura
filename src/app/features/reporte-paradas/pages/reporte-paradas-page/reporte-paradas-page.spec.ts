import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { PoDialogService, PoNotificationService } from '@po-ui/ng-components';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { ContextoProducaoSelector } from '../../../shop-floor/components/contexto-producao-selector/contexto-producao-selector';
import { ProductionContext, StopEntry } from '../../models/reporte-paradas.model';
import { ReporteParadasService } from '../../services/reporte-paradas.service';
import { ReporteParadasPage } from './reporte-paradas-page';

describe('ReporteParadasPage', () => {
  let fixture: ComponentFixture<ReporteParadasPage>;
  let component: ReporteParadasPage;
  let service: {
    listarAreas: ReturnType<typeof vi.fn>;
    pesquisarCentros: ReturnType<typeof vi.fn>;
    listarResponsaveis: ReturnType<typeof vi.fn>;
    listarMotivos: ReturnType<typeof vi.fn>;
    registrarParada: ReturnType<typeof vi.fn>;
    listarParadasEmAndamento: ReturnType<typeof vi.fn>;
    finalizarParada: ReturnType<typeof vi.fn>;
    getPrefillContext: ReturnType<typeof vi.fn>;
    clearPrefillContext: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let dialog: { confirm: ReturnType<typeof vi.fn> };
  let notification: {
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const area = { code: '4001', description: 'Produção' };
  const center = {
    code: 'CT-EXT-01',
    description: 'Extrusão',
    areaCode: '4001',
    area: 'Produção',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
  const responsible = { tipo: 'OPERADOR' as const, codigo: 'OP-001', nome: 'Ana' };
  const prefill: ProductionContext = {
    area,
    workCenter: center,
    origin: { type: 'OPERATION_REPORT', sourceRoute: '/operation-reporting', reportId: 'OP-1' },
    preferredResponsible: responsible,
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    service = {
      listarAreas: vi.fn(() => of([area])),
      pesquisarCentros: vi.fn(() => of([center])),
      listarResponsaveis: vi.fn(() => of([responsible])),
      listarMotivos: vi.fn(() => of([{ id: 1, code: '01', description: 'Setup' }])),
      registrarParada: vi.fn(request => of({
        id: 1,
        context: prefill,
        reason: { id: 1, code: '01', description: 'Setup' },
        responsible,
        startDate: new Date(2026, 6, 28),
        startTime: request.startTime,
        endTime: '',
        programmed: request.programmed,
        status: 'EM_ANDAMENTO',
        idempotencyKey: request.idempotencyKey,
        syncStatus: 'PENDING',
      })),
      listarParadasEmAndamento: vi.fn(() => of([])),
      finalizarParada: vi.fn((_stopId, request) => of({
        ...openStop(),
        status: 'FINALIZADA',
        endDate: new Date(2026, 6, 28),
        endTime: request.endTime,
        durationMinutes: 90,
      })),
      getPrefillContext: vi.fn(() => null),
      clearPrefillContext: vi.fn(),
    };
    router = { navigate: vi.fn().mockResolvedValue(true) };
    dialog = { confirm: vi.fn() };
    notification = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ReporteParadasPage],
      providers: [
        { provide: ReporteParadasService, useValue: service },
        { provide: Router, useValue: router },
        { provide: PoDialogService, useValue: dialog },
        { provide: PoNotificationService, useValue: notification },
        {
          provide: AuthSessionService,
          useValue: { session$: new BehaviorSubject<unknown>({ user: 'operador' }) },
        },
      ],
    }).compileComponents();
    TestBed.overrideProvider(PoDialogService, { useValue: dialog });
    TestBed.overrideProvider(PoNotificationService, { useValue: notification });
    fixture = TestBed.createComponent(ReporteParadasPage);
    component = fixture.componentInstance;
  });

  it('permite acesso direto sem contexto e carrega Áreas', () => {
    fixture.detectChanges();

    expect(service.listarAreas).toHaveBeenCalledOnce();
    expect(component.view().area).toBeNull();
    expect(fixture.debugElement.query(By.directive(ContextoProducaoSelector))).toBeTruthy();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['OPERATION_REPORT', '/operation-reporting'],
    ['BATCH_REPORT', '/batch-reporting'],
  ] as const)('revalida e aplica prefill integral da origem %s', (type, sourceRoute) => {
    service.getPrefillContext.mockReturnValue({
      ...prefill,
      origin: { type, sourceRoute },
    });

    fixture.detectChanges();

    expect(component.view()).toEqual(expect.objectContaining({
      area,
      workCenter: center,
      responsibleCode: 'OP-001',
      origin: expect.objectContaining({ type, sourceRoute }),
    }));
    expect(service.clearPrefillContext).toHaveBeenCalledOnce();
  });

  it('não aplica parcialmente prefill inelegível', () => {
    service.getPrefillContext.mockReturnValue({
      ...prefill,
      workCenter: { ...center, code: 'INATIVO', active: false },
    });

    fixture.detectChanges();

    expect(component.view().area).toBeNull();
    expect(component.view().workCenter).toBeNull();
  });

  it('confirma descarte do rascunho antes de trocar contexto e preserva tudo ao cancelar', () => {
    fixture.detectChanges();
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');
    component.onDraftChange({
      reasonId: 1,
      startDate: '2026-07-28',
      startTime: '08:00',
      endDate: null,
      endTime: '',
      programmed: false,
    });
    const before = component.view();
    expect(before.area?.code).toBe('4001');
    expect(before.dirty).toBe(true);

    component.onAreaChange('');

    expect(dialog.confirm).toHaveBeenCalledOnce();
    expect(component.view()).toEqual(before);

    dialog.confirm.mock.calls[0][0].confirm();
    expect(component.view().area).toBeNull();
    expect(component.view().draft.reasonId).toBeNull();
  });

  it('ignora resultado obsoleto depois da troca de Centro', () => {
    const oldResponsibles = new Subject<ReadonlyArray<typeof responsible>>();
    service.listarResponsaveis
      .mockReturnValueOnce(oldResponsibles.asObservable())
      .mockReturnValueOnce(of([]));
    const secondCenter = { ...center, code: 'CT-EXT-02', description: 'Extrusão 2' };
    service.pesquisarCentros.mockReturnValue(of([center, secondCenter]));
    fixture.detectChanges();
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');
    component.onWorkCenterChange('CT-EXT-02');

    oldResponsibles.next([responsible]);
    oldResponsibles.complete();

    expect(component.view().workCenter?.code).toBe('CT-EXT-02');
    expect(component.view().responsibles).toEqual([]);
  });

  it('distingue erro do catálogo de lista elegível vazia e oferece retry', () => {
    service.listarResponsaveis.mockReturnValueOnce(
      throwError(() => new Error('Catálogo indisponível')),
    );
    fixture.detectChanges();
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');

    expect(component.view().contextError).toContain('responsáveis');

    component.retryContext();
    expect(service.listarResponsaveis).toHaveBeenCalledTimes(2);
  });

  it('bloqueia duplo clique, preserva rascunho no erro e reutiliza a chave', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 8));
    const pending = new Subject<never>();
    service.registrarParada.mockReturnValueOnce(pending.asObservable());
    fixture.detectChanges();
    prepareValidDraft();

    component.registrarParada();
    const firstRequest = service.registrarParada.mock.calls[0][0];
    expect(firstRequest.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    component.registrarParada();

    expect(service.registrarParada).toHaveBeenCalledOnce();
    pending.error(new Error('Falha antes do commit'));
    expect(component.view().draft.reasonId).toBe(1);
    expect(component.view().idempotencyKey).toBe(firstRequest.idempotencyKey);

    component.registrarParada();
    expect(service.registrarParada.mock.calls[1][0].idempotencyKey)
      .toBe(firstRequest.idempotencyKey);
  });

  it('informa sucesso apenas local/pendente e preserva o contexto para novo registro', () => {
    fixture.detectChanges();
    prepareValidDraft();

    component.registrarParada();

    expect(notification.success).toHaveBeenCalledWith(
      expect.stringMatching(/salva neste dispositivo.*pendente/i),
    );
    expect(component.view().area).toEqual(area);
    expect(component.view().workCenter).toEqual(center);
    expect(component.view().draft.reasonId).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('volta para origem válida ou menu no acesso direto', () => {
    fixture.detectChanges();
    component.voltar();
    expect(router.navigate).toHaveBeenLastCalledWith(['/menu']);

    service.getPrefillContext.mockReturnValue(prefill);
    const secondFixture = TestBed.createComponent(ReporteParadasPage);
    secondFixture.detectChanges();
    secondFixture.componentInstance.voltar();
    expect(router.navigate).toHaveBeenLastCalledWith(['/operation-reporting']);
  });

  it('consulta abertas após contexto válido e distingue o relógio page-scoped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 9));
    service.listarParadasEmAndamento.mockReturnValue(of([openStop()]));
    fixture.detectChanges();
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');

    expect(service.listarParadasEmAndamento).toHaveBeenCalledWith('4001', 'CT-EXT-01');
    expect(component.view().openStops).toHaveLength(1);
    expect(component.now()).toEqual(new Date(2026, 6, 28, 9));

    vi.advanceTimersByTime(60_000);
    expect(component.now()).toEqual(new Date(2026, 6, 28, 9, 1));
  });

  it('preserva seleção, fim e chave após falha e reutiliza no retry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 9, 30));
    service.listarParadasEmAndamento.mockReturnValue(of([openStop()]));
    service.finalizarParada.mockReturnValueOnce(
      throwError(() => new Error('HTTP 503 com detalhes internos')),
    );
    fixture.detectChanges();
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');
    component.selecionarParada(42);

    component.finalizarParada();
    const first = service.finalizarParada.mock.calls[0][1];

    expect(component.view()).toEqual(expect.objectContaining({
      selectedStopId: 42,
      finishDraft: { endDate: '2026-07-28', endTime: '09:30' },
      finishIdempotencyKey: first.idempotencyKey,
    }));
    expect(component.view().finishError).not.toContain('HTTP');

    component.finalizarParada();
    expect(service.finalizarParada.mock.calls[1][1].idempotencyKey).toBe(first.idempotencyKey);
  });

  it.each([
    ['OPERATION_REPORT', '/operation-reporting'],
    ['BATCH_REPORT', '/batch-reporting'],
  ] as const)('remove somente a finalizada e retorna à origem %s após sucesso', (type, sourceRoute) => {
    service.getPrefillContext.mockReturnValue({
      ...prefill,
      origin: { type, sourceRoute },
    });
    service.listarParadasEmAndamento.mockReturnValue(of([openStop(), openStop(43)]));
    fixture.detectChanges();
    component.selecionarParada(42);

    component.finalizarParada();

    expect(component.view().openStops.map(stop => stop.id)).toEqual([43]);
    expect(component.view().selectedStopId).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith([sourceRoute]);
  });

  function prepareValidDraft(): void {
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');
    component.onResponsibleTypeChange('OPERADOR');
    component.onResponsibleCodeChange('OP-001');
    component.onDraftChange({
      reasonId: 1,
      startDate: '2026-07-28',
      startTime: '08:00',
      endDate: null,
      endTime: '',
      programmed: false,
    });
  }

  function openStop(id = 42): StopEntry {
    return {
      id,
      context: prefill,
      reason: { id: 1, code: '01', description: 'Setup' },
      responsible,
      startDate: new Date(2026, 6, 28),
      startTime: '08:00',
      programmed: false,
      status: 'EM_ANDAMENTO',
      idempotencyKey: `start-${id}`,
      syncStatus: 'PENDING',
    };
  }
});
