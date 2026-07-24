import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoDialogService, PoNotificationService } from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { ContextoProducaoBatelada } from '../../components/contexto-producao/contexto-producao';
import { OrdensCentroBateladaList } from '../../components/ordens-centro-list/ordens-centro-list';
import { ReporteBateladaSlide } from '../../components/reporte-batelada-slide/reporte-batelada-slide';
import {
  OrdemLiberadaBatelada,
  RascunhoReporteBatelada,
  ReporteParcialBatelada,
} from '../../models/reporta-batelada.model';
import { ReportaBateladaService } from '../../services/reporta-batelada.service';

import { ReportaBateladaPage } from './reporta-batelada-page';

describe('ReportaBateladaPage - consulta e seleção', () => {
  let fixture: ComponentFixture<ReportaBateladaPage>;
  let component: ReportaBateladaPage;
  let currentContext: ReturnType<typeof context> | null;
  let routerMock: { navigate: ReturnType<typeof vi.fn> };
  let dialogMock: { confirm: ReturnType<typeof vi.fn> };
  let notificationMock: {
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    information: ReturnType<typeof vi.fn>;
  };
  const session$ = new BehaviorSubject<unknown>({ user: 'operador' });
  let serviceMock: {
    listarAreas: ReturnType<typeof vi.fn>;
    pesquisarCentros: ReturnType<typeof vi.fn>;
    listarOrdensLiberadas: ReturnType<typeof vi.fn>;
    listarResponsaveisElegiveis: ReturnType<typeof vi.fn>;
    montarComandoInicio: ReturnType<typeof vi.fn>;
    iniciarBatelada: ReturnType<typeof vi.fn>;
    listarReportesBatelada: ReturnType<typeof vi.fn>;
    reportarBateladaParcial: ReturnType<typeof vi.fn>;
    encerrarBatelada: ReturnType<typeof vi.fn>;
    preservarFluxoParada: ReturnType<typeof vi.fn>;
    retomarFluxoParada: ReturnType<typeof vi.fn>;
    descartarFluxoParada: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    currentContext = context();
    routerMock = { navigate: vi.fn().mockResolvedValue(true) };
    dialogMock = { confirm: vi.fn() };
    notificationMock = {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      information: vi.fn(),
    };
    session$.next({ user: 'operador' });
    serviceMock = {
      listarAreas: vi.fn(() => of([{ code: '4001', description: 'Produção' }])),
      pesquisarCentros: vi.fn(() => of([context().workCenter])),
      listarOrdensLiberadas: vi.fn(() => of(orders())),
      listarResponsaveisElegiveis: vi.fn(() => of([])),
      montarComandoInicio: vi.fn((contexto, responsavel, ordensSelecionadas) => ({
        contexto,
        responsavel,
        ordens: ordensSelecionadas,
      })),
      iniciarBatelada: vi.fn(() => of({
        batchId: 'batch-1',
        iniciadoEm: new Date(2026, 6, 23, 8, 15),
        ordensIniciadas: ['2', '1'],
      })),
      listarReportesBatelada: vi.fn(() => of([])),
      reportarBateladaParcial: vi.fn(request => of({
        reporteId: 'report-1',
        batchId: request.batchId,
        idempotencyKey: request.idempotencyKey,
        confirmadoEm: new Date(2026, 6, 23, 9),
        items: request.items,
      })),
      encerrarBatelada: vi.fn(request => of({
        batchId: request.batchId,
        encerradoEm: new Date(2026, 6, 23, 12),
        ordensEncerradas: request.orderIds,
      })),
      preservarFluxoParada: vi.fn(),
      retomarFluxoParada: vi.fn(() => null),
      descartarFluxoParada: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ReportaBateladaPage],
      providers: [
        { provide: ReportaBateladaService, useValue: serviceMock },
        { provide: OperationalContextService, useValue: { get currentContext() { return currentContext; } } },
        { provide: AuthSessionService, useValue: { session$ } },
        { provide: Router, useValue: routerMock },
        { provide: PoDialogService, useValue: dialogMock },
        { provide: PoNotificationService, useValue: notificationMock },
      ],
    })
      .overrideProvider(PoDialogService, { useValue: dialogMock })
      .compileComponents();

    fixture = TestBed.createComponent(ReportaBateladaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('prefills Area and CT from a BATCH operational context', () => {
    expect(component.view.area?.code).toBe('4001');
    expect(component.view.workCenter?.code).toBe('CT-EXT-01');
    expect(serviceMock.pesquisarCentros).toHaveBeenCalledWith('4001', '');
  });

  it('supports direct Home access without fabricating context', () => {
    currentContext = null;
    fixture = TestBed.createComponent(ReportaBateladaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.view.area).toBeNull();
    expect(component.view.workCenter).toBeNull();
    expect(component.areas).toEqual([{ code: '4001', description: 'Produção' }]);
  });

  it('invalidates CT, orders and selection when Area changes', () => {
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['1', '2']));
    component.prepararBatelada();

    component.selecionarArea('');

    expect(component.view.workCenter).toBeNull();
    expect(component.view.orders).toEqual([]);
    expect(component.view.composition).toEqual([]);
  });

  it('cancels a pending centers lookup when Area is cleared', () => {
    const pending = new Subject<ReadonlyArray<ReturnType<typeof context>['workCenter']>>();
    component.areas = [
      { code: '4001', description: 'Produção' },
      { code: '4002', description: 'Qualidade' },
    ];
    serviceMock.pesquisarCentros.mockReturnValueOnce(pending);

    component.selecionarArea('4002');
    expect(component.loadingCenters).toBe(true);

    component.selecionarArea('');
    pending.next([context().workCenter]);

    expect(component.loadingCenters).toBe(false);
    expect(component.centers).toEqual([]);
    expect(component.view.area).toBeNull();
  });

  it('ignores a stale centers error after Area is cleared', () => {
    const pending = new Subject<ReadonlyArray<ReturnType<typeof context>['workCenter']>>();
    component.areas = [
      { code: '4001', description: 'Produção' },
      { code: '4002', description: 'Qualidade' },
    ];
    serviceMock.pesquisarCentros.mockReturnValueOnce(pending);

    component.selecionarArea('4002');
    component.selecionarArea('');
    pending.error(new Error('offline'));

    expect(notificationMock.error).not.toHaveBeenCalledWith(
      'Não foi possível carregar os Centros de Trabalho.',
    );
  });

  it('renders empty, error and retry states without losing context', () => {
    serviceMock.listarOrdensLiberadas.mockReturnValueOnce(of([]));
    component.consultarOrdens();
    expect(component.view.asyncState).toBe('vazio');

    serviceMock.listarOrdensLiberadas.mockReturnValueOnce(throwError(() => new Error('offline')));
    component.consultarOrdens();

    expect(component.view.asyncState).toBe('erro');
    expect(component.view.area?.code).toBe('4001');
    expect(component.view.workCenter?.code).toBe('CT-EXT-01');

    component.consultarOrdens();
    expect(serviceMock.listarOrdensLiberadas).toHaveBeenCalledTimes(3);
  });

  it('renders a query error only once for assistive technology', () => {
    serviceMock.listarOrdensLiberadas.mockReturnValueOnce(throwError(() => new Error('offline')));

    component.consultarOrdens();
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.contexto-producao__error'))).toHaveLength(1);
    expect(fixture.debugElement.query(By.css('.reporta-batelada__feedback--error'))).toBeNull();
  });

  it('ignores an obsolete order response after the work center changes', () => {
    const first = new Subject<ReadonlyArray<OrdemLiberadaBatelada>>();
    serviceMock.listarOrdensLiberadas.mockReturnValueOnce(first);
    component.consultarOrdens();

    component.selecionarCentro('');
    first.next(orders());

    expect(component.view.orders).toEqual([]);
  });

  it('preserves touch/table selection order when preparing the composition', () => {
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['2']));
    component.atualizarSelecao(new Set(['2', '1']));

    component.prepararBatelada();

    expect(component.view.composition.map(order => order.id)).toEqual(['2', '1']);
  });

  it('sends exactly one ordered command for every order in the composition', () => {
    prepareForStart();

    component.iniciarBatelada();

    expect(serviceMock.montarComandoInicio).toHaveBeenCalledWith(
      { areaCode: '4001', workCenterCode: 'CT-EXT-01' },
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
      [orders()[1], orders()[0]],
    );
    expect(serviceMock.iniciarBatelada).toHaveBeenCalledOnce();
    expect(component.view.estado).toBe('BateladaIniciada');
    expect(component.view.inicio?.ordensIniciadas).toEqual(['2', '1']);
  });

  it('prevents duplicate start commands from double click', () => {
    const pending = new Subject<{
      readonly batchId: string;
      readonly iniciadoEm: Date;
      readonly ordensIniciadas: ReadonlyArray<string>;
    }>();
    serviceMock.iniciarBatelada.mockReturnValue(pending);
    prepareForStart();

    component.iniciarBatelada();
    component.iniciarBatelada();

    expect(serviceMock.iniciarBatelada).toHaveBeenCalledOnce();
    expect(component.view.estado).toBe('Iniciando');
  });

  it('does not present a start request as an orders lookup', () => {
    serviceMock.iniciarBatelada.mockReturnValue(new Subject());
    prepareForStart();

    component.iniciarBatelada();
    fixture.detectChanges();

    const contextCard = fixture.debugElement.query(By.directive(ContextoProducaoBatelada))
      .componentInstance as ContextoProducaoBatelada;
    const ordersList = fixture.debugElement.query(By.directive(OrdensCentroBateladaList))
      .componentInstance as OrdensCentroBateladaList;
    expect(contextCard.loadingOrders).toBe(false);
    expect(ordersList.loading).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Consultando ordens...');
    expect(fixture.nativeElement.textContent).toContain('Iniciando todas as ordens');
  });

  it('preserves context, responsible party and composition on total/partial failure and allows retry', () => {
    serviceMock.iniciarBatelada.mockReturnValueOnce(
      throwError(() => new Error('O início conjunto não foi confirmado para todas as ordens.')),
    );
    prepareForStart();

    component.iniciarBatelada();

    expect(component.view.estado).toBe('BateladaPreparada');
    expect(component.view.composition.map(order => order.id)).toEqual(['2', '1']);
    expect(component.view.responsavel?.codigo).toBe('OP-001');
    expect(component.view.errorMessage).toContain('Não foi possível iniciar');
    fixture.detectChanges();
    const contextCard = fixture.debugElement.query(By.directive(ContextoProducaoBatelada))
      .componentInstance as ContextoProducaoBatelada;
    expect(contextCard.errorMessage).toBe('');

    component.iniciarBatelada();
    expect(serviceMock.iniciarBatelada).toHaveBeenCalledTimes(2);
    expect(component.view.estado).toBe('BateladaIniciada');
  });

  it('shows a technical responsible lookup error and retries it without requerying orders', () => {
    serviceMock.listarResponsaveisElegiveis
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of([
        { tipo: 'OPERADOR' as const, codigo: 'OP-001', nome: 'Ana Silva' },
      ]));

    component.consultarOrdens();

    const reviewable = component as unknown as {
      responsaveisErrorMessage: string;
      tentarCarregarResponsaveisNovamente(): void;
    };
    expect(reviewable.responsaveisErrorMessage).toContain('carregar os responsáveis');
    reviewable.tentarCarregarResponsaveisNovamente();

    expect(serviceMock.listarOrdensLiberadas).toHaveBeenCalledOnce();
    expect(serviceMock.listarResponsaveisElegiveis).toHaveBeenCalledTimes(2);
    expect(reviewable.responsaveisErrorMessage).toBe('');
  });

  it('ignores an obsolete responsible retry after a newer retry succeeds', () => {
    const firstRetry = new Subject<ReadonlyArray<{
      tipo: 'OPERADOR';
      codigo: string;
      nome: string;
    }>>();
    const secondRetry = new Subject<ReadonlyArray<{
      tipo: 'OPERADOR';
      codigo: string;
      nome: string;
    }>>();
    serviceMock.listarResponsaveisElegiveis
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(firstRetry)
      .mockReturnValueOnce(secondRetry);
    component.consultarOrdens();

    component.tentarCarregarResponsaveisNovamente();
    component.tentarCarregarResponsaveisNovamente();
    secondRetry.next([{ tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' }]);
    firstRetry.error(new Error('late failure'));

    expect(component.responsaveisErrorMessage).toBe('');
    expect(component.view.responsaveis).toEqual([
      { tipo: 'OPERADOR', codigo: 'OP-001', nome: 'Ana Silva' },
    ]);
  });

  it('does not mutate visible context after the batch lock rejects an Area change', () => {
    prepareForStart();
    component.iniciarBatelada();
    const centersBefore = component.centers;

    component.selecionarArea('');

    expect(component.centers).toBe(centersBefore);
    expect(component.view.area?.code).toBe('4001');
    expect(component.view.workCenter?.code).toBe('CT-EXT-01');
  });

  it('reflects workflow cleanup immediately after logout', () => {
    prepareForStart();

    session$.next(null);

    expect(component.view.area).toBeNull();
    expect(component.view.workCenter).toBeNull();
    expect(component.view.composition).toEqual([]);
  });

  it('does not repopulate Areas from a response that arrives after logout', () => {
    const pending = new Subject<ReadonlyArray<{ code: string; description: string }>>();
    serviceMock.listarAreas.mockReturnValueOnce(pending);
    session$.next({ user: 'operador' });
    fixture = TestBed.createComponent(ReportaBateladaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();

    session$.next(null);
    pending.next([{ code: '4002', description: 'Qualidade' }]);

    expect(component.areas).toEqual([]);
    expect(component.view.area).toBeNull();
  });

  it('keeps start unavailable without an eligible responsible party', () => {
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['1']));
    component.prepararBatelada();

    component.iniciarBatelada();

    expect(serviceMock.iniciarBatelada).not.toHaveBeenCalled();
    expect(component.view.estado).toBe('BateladaPreparada');
  });

  it('loads history when opening the report drawer and keeps composition order', () => {
    prepareForStart();
    component.iniciarBatelada();
    const slide = fixture.debugElement.query(By.directive(ReporteBateladaSlide))
      .componentInstance as ReporteBateladaSlide;

    component.abrirReporte();

    expect(serviceMock.listarReportesBatelada).toHaveBeenCalledWith('batch-1');
    expect(slide.items.map(item => item.orderId)).toEqual(['2', '1']);
    expect(component.view.estado).toBe('BateladaIniciada');
  });

  it('applies a late history response without reopening or resetting the drawer', () => {
    const pending = new Subject<ReadonlyArray<ReporteParcialBatelada>>();
    serviceMock.listarReportesBatelada.mockReturnValueOnce(pending);
    prepareForStart();
    component.iniciarBatelada();
    const slide = fixture.debugElement.query(By.directive(ReporteBateladaSlide))
      .componentInstance as ReporteBateladaSlide;
    const open = vi.spyOn(slide, 'abrir');
    const update = vi.spyOn(slide, 'atualizarHistorico');

    component.abrirReporte();
    pending.next([confirmedReport('idem-history')]);

    expect(open).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(component.view.history).toHaveLength(1);
  });

  it('sends one ordered partial command, updates history and keeps the batch started', () => {
    prepareForStart();
    component.iniciarBatelada();
    const draft = reportDraft('idem-1');

    component.salvarReporte(draft);
    component.salvarReporte(draft);

    expect(serviceMock.reportarBateladaParcial).toHaveBeenCalledOnce();
    expect(serviceMock.reportarBateladaParcial).toHaveBeenCalledWith({
      batchId: 'batch-1',
      idempotencyKey: 'idem-1',
      items: draft.items,
    });
    expect(component.view.estado).toBe('BateladaIniciada');
    expect(component.view.history).toHaveLength(1);
    expect(component.view.draft?.items.every(item => item.quantidadeAprovada === 0)).toBe(true);
  });

  it('preserves the draft and idempotency key after report failure for retry', () => {
    serviceMock.reportarBateladaParcial
      .mockReturnValueOnce(throwError(() => new Error('offline')));
    prepareForStart();
    component.iniciarBatelada();
    const draft = reportDraft('idem-retry');

    component.salvarReporte(draft);
    expect(component.view.draft?.idempotencyKey).toBe('idem-retry');
    expect(component.view.estado).toBe('BateladaIniciada');

    component.salvarReporte(component.view.draft!);

    expect(serviceMock.reportarBateladaParcial).toHaveBeenCalledTimes(2);
    expect(serviceMock.reportarBateladaParcial.mock.calls[1][0].idempotencyKey)
      .toBe('idem-retry');
  });

  it('finishes drawer loading when the same idempotency key is already confirmed', () => {
    prepareForStart();
    component.iniciarBatelada();
    const draft = reportDraft('idem-confirmed');
    component.salvarReporte(draft);
    const slide = fixture.debugElement.query(By.directive(ReporteBateladaSlide))
      .componentInstance as ReporteBateladaSlide;
    const informarErro = vi.spyOn(slide, 'informarErro');

    component.salvarReporte(draft);

    expect(informarErro).toHaveBeenCalledWith('Este reporte já foi confirmado no histórico.');
    expect(serviceMock.reportarBateladaParcial).toHaveBeenCalledOnce();
  });

  it('ends only after confirmation, without an implicit report, and returns to work center', () => {
    prepareForStart();
    component.iniciarBatelada();

    component.encerrarBatelada();
    expect(serviceMock.encerrarBatelada).not.toHaveBeenCalled();
    const confirmation = dialogMock.confirm.mock.calls[0][0];
    confirmation.confirm();

    expect(serviceMock.encerrarBatelada).toHaveBeenCalledOnce();
    expect(serviceMock.reportarBateladaParcial).not.toHaveBeenCalled();
    expect(component.view.estado).toBe('Encerrada');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/work-center']);
  });

  it('does not end or alter the batch when confirmation is cancelled', () => {
    prepareForStart();
    component.iniciarBatelada();

    component.encerrarBatelada();

    expect(dialogMock.confirm).toHaveBeenCalledOnce();
    expect(serviceMock.encerrarBatelada).not.toHaveBeenCalled();
    expect(component.view.estado).toBe('BateladaIniciada');
  });

  it('warns that an unsaved draft will be discarded before ending', () => {
    prepareForStart();
    component.iniciarBatelada();
    component.atualizarRascunho(reportDraft('idem-unsaved'));

    component.encerrarBatelada();

    expect(dialogMock.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('quantidades não salvas'),
    }));
  });

  it('protects navigation while a batch is active and allows cancelling the discard', () => {
    prepareForStart();
    component.iniciarBatelada();

    component.voltar();

    expect(routerMock.navigate).not.toHaveBeenCalledWith(['/work-center']);
    expect(dialogMock.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Sair da batelada?',
      confirm: expect.any(Function),
    }));
  });

  it('protects navigation while the joint start is still pending', () => {
    serviceMock.iniciarBatelada.mockReturnValueOnce(new Subject());
    prepareForStart();
    component.iniciarBatelada();

    component.voltar();

    expect(component.view.estado).toBe('Iniciando');
    expect(dialogMock.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Sair da batelada?',
    }));
  });

  it('ignores an obsolete report response after confirmed navigation', () => {
    const pending = new Subject<ReporteParcialBatelada>();
    serviceMock.reportarBateladaParcial.mockReturnValueOnce(pending);
    prepareForStart();
    component.iniciarBatelada();
    component.salvarReporte(reportDraft('idem-stale'));

    component.voltar();
    dialogMock.confirm.mock.calls.at(-1)![0].confirm();
    pending.next(confirmedReport('idem-stale'));

    expect(component.view.estado).toBe('ContextoPendente');
    expect(component.view.history).toEqual([]);
  });

  it('preserves history and operational state when ending fails', () => {
    serviceMock.encerrarBatelada.mockReturnValueOnce(throwError(() => new Error('partial')));
    prepareForStart();
    component.iniciarBatelada();
    component.salvarReporte(reportDraft('idem-history'));

    component.encerrarBatelada();
    dialogMock.confirm.mock.calls.at(-1)![0].confirm();

    expect(component.view.estado).toBe('BateladaIniciada');
    expect(component.view.endingAsyncState).toBe('erro');
    expect(component.view.history).toHaveLength(1);
  });

  it('transfers and restores the complete batch state through the stoppage route', () => {
    prepareForStart();
    component.iniciarBatelada();
    component.salvarReporte(reportDraft('idem-stop'));
    component.abrirParada();
    const preserved = serviceMock.preservarFluxoParada.mock.calls[0][0];

    expect(preserved.estado).toBe('EmParada');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/stoppages']);

    serviceMock.retomarFluxoParada.mockReturnValueOnce(preserved);
    fixture = TestBed.createComponent(ReportaBateladaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.view.estado).toBe('BateladaIniciada');
    expect(component.view.history).toHaveLength(1);
    expect(component.view.composition.map(order => order.id)).toEqual(['2', '1']);
  });

  it('returns to the operational state when stoppage navigation is cancelled', async () => {
    routerMock.navigate.mockResolvedValueOnce(false);
    prepareForStart();
    component.iniciarBatelada();

    component.abrirParada();
    await vi.waitFor(() => expect(component.view.estado).toBe('BateladaIniciada'));

    expect(serviceMock.descartarFluxoParada).toHaveBeenCalledOnce();
    expect(notificationMock.error).toHaveBeenCalledWith(
      'Não foi possível abrir o reporte de Paradas.',
    );
  });

  function prepareForStart(): void {
    serviceMock.listarResponsaveisElegiveis.mockReturnValue(of([
      { tipo: 'OPERADOR' as const, codigo: 'OP-001', nome: 'Ana Silva' },
    ]));
    component.consultarOrdens();
    component.atualizarSelecao(new Set(['2']));
    component.atualizarSelecao(new Set(['2', '1']));
    component.prepararBatelada();
  }
});

function context() {
  return {
    workCenter: {
      code: 'CT-EXT-01',
      description: 'Extrusão Linha 01',
      areaCode: '4001',
      area: 'Produção',
      machineGroup: 'Extrusoras',
      establishment: '101',
      active: true,
    },
    operator: { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
    reportType: 'BATCH' as const,
    validity: '2026-07-23',
  };
}

function orders(): ReadonlyArray<OrdemLiberadaBatelada> {
  return [
    { id: '1', ordem: '450001', itemOp: 'ITEM-1 / OP-1', operacao: '10', split: '01' },
    { id: '2', ordem: '450002', itemOp: 'ITEM-2 / OP-2', operacao: '20', split: '01' },
  ];
}

function reportDraft(idempotencyKey: string): RascunhoReporteBatelada {
  return {
    idempotencyKey,
    items: [
      {
        orderId: '2',
        ordem: '450002',
        quantidadeAprovada: 2,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 0,
        refugoItens: [],
      },
      {
        orderId: '1',
        ordem: '450001',
        quantidadeAprovada: 1,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 0,
        refugoItens: [],
      },
    ],
  };
}

function confirmedReport(idempotencyKey: string): ReporteParcialBatelada {
  return {
    reporteId: `report-${idempotencyKey}`,
    batchId: 'batch-1',
    idempotencyKey,
    confirmadoEm: new Date(2026, 6, 23, 9),
    items: reportDraft(idempotencyKey).items,
  };
}
