import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoDialogService, PoNotificationService } from '@po-ui/ng-components';

import { AuthSession } from '../../../../core/auth/auth.models';
import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import {
  OperationalCorrectionContextService,
} from '../../../../core/offline/services/operational-correction-context.service';
import {
  PersistedSyncError,
  RemoteCommandReceipt,
} from '../../../../core/offline/models/outbox-entry';
import {
  GerenciarEquipeResultado,
  GerenciarEquipeSlide,
} from '../../../equipes/components/gerenciar-equipe-slide/gerenciar-equipe-slide';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { ContextoProducaoSelector } from '../../../shop-floor/components/contexto-producao-selector/contexto-producao-selector';
import { OperacaoInfoCard } from '../../components/operacao-info-card/operacao-info-card';
import {
  EstadoOperacao,
  OrdemCentroTrabalho,
  ReportOperacao,
  ReporteOperacaoResultado,
} from '../../models/report-operacao.model';
import { ReportOperacaoWorkflowState } from '../../services/report-operacao-workflow-state';
import { ReportOperacaoService } from '../../services/report-operacao.service';
import { ReportOperacaoPage } from './report-operacao-page';

describe('ReportOperacaoPage', () => {
  let fixture: ComponentFixture<ReportOperacaoPage>;
  let component: ReportOperacaoPage;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let dialog: { confirm: ReturnType<typeof vi.fn> };
  let stoppages: {
    setPrefillContext: ReturnType<typeof vi.fn>;
    clearPrefillContext: ReturnType<typeof vi.fn>;
  };
  let notification: {
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    information: ReturnType<typeof vi.fn>;
  };
  let workflow: ReportOperacaoWorkflowState;
  let operationalContext: { currentContext: ReturnType<typeof context> | null; setContext: ReturnType<typeof vi.fn> };
  let reportSequence: number;
  let session$: BehaviorSubject<AuthSession | null>;
  let correctionContext: OperationalCorrectionContextService;
  let service: {
    listarAreasProducao: ReturnType<typeof vi.fn>;
    pesquisarCentrosTrabalho: ReturnType<typeof vi.fn>;
    listarOrdensPorCentro: ReturnType<typeof vi.fn>;
    carregarOrdemSelecionada: ReturnType<typeof vi.fn>;
    listarResponsaveis: ReturnType<typeof vi.fn>;
    iniciarOperacao: ReturnType<typeof vi.fn>;
    reportarOperacao: ReturnType<typeof vi.fn>;
    encerrarOperacao: ReturnType<typeof vi.fn>;
    validarReporte: ReturnType<typeof vi.fn>;
    validarReporteParcial: ReturnType<typeof vi.fn>;
    restaurarOperacaoAtiva: ReturnType<typeof vi.fn>;
  };

  const orders: OrdemCentroTrabalho[] = [
    {
      id: 'first', ordem: '450001', itemOp: 'PERFIL-100 / OP-10458', operacao: '10', split: '01',
      areaCode: '4001', workCenterCode: 'CT-EXT-01',
    },
    {
      id: 'second', ordem: '450002', itemOp: 'PERFIL-200 / OP-10459', operacao: '20', split: '01',
      areaCode: '4001', workCenterCode: 'CT-EXT-01',
    },
  ];
  const receipt: RemoteCommandReceipt = {
    serverRecordId: 'DATASUL-1',
    receivedAt: '2026-08-28T13:00:00.000Z',
    processedAt: '2026-08-28T13:00:01.000Z',
    duplicate: false,
  };
  const persistedError: PersistedSyncError = {
    code: 'INVALID_REPORT',
    category: 'VALIDATION',
    userMessage: 'O Datasul rejeitou o reporte.',
  };

  beforeEach(async () => {
    router = { navigate: vi.fn().mockResolvedValue(true) };
    dialog = { confirm: vi.fn() };
    workflow = new ReportOperacaoWorkflowState();
    reportSequence = 0;
    session$ = new BehaviorSubject<AuthSession | null>({
      user: { id: '1', nome: 'Andre', login: 'andre', permissoes: [] },
      mode: 'ONLINE',
      token: 'token',
      authenticatedAt: new Date(),
      lastValidatedAt: new Date(),
    });
    operationalContext = { currentContext: null, setContext: vi.fn() };
    stoppages = { setPrefillContext: vi.fn(), clearPrefillContext: vi.fn() };
    notification = {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      information: vi.fn(),
    };
    service = {
      listarAreasProducao: vi.fn(() => of([{ code: '4001', description: 'Produção' }, { code: '4002', description: 'Qualidade' }])),
      pesquisarCentrosTrabalho: vi.fn((areaCode: string) => of(areaCode === '4001' ? [center()] : [])),
      listarOrdensPorCentro: vi.fn(() => of(orders)),
      carregarOrdemSelecionada: vi.fn((order: OrdemCentroTrabalho) =>
        of({ sucesso: true, operacao: baseOperacao({ ordem: order.ordem, op: order.itemOp.split(' / ')[1] }) })),
      listarResponsaveis: vi.fn(() => of([
        { tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva' },
        { tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Equipe A' },
      ])),
      iniciarOperacao: vi.fn(request => of({
        dataInicio: request.dataInicio,
        horaInicio: request.horaInicio,
        delivery: { status: 'PENDING' as const },
      })),
      reportarOperacao: vi.fn(() => {
        reportSequence += 1;
        return of({
          apontamentoId: `APT-${reportSequence}`,
          reportadoEm: new Date(),
          delivery: { status: 'PENDING' as const },
        });
      }),
      encerrarOperacao: vi.fn(() => of({ apontamentoId: 'ENC-1', reportadoEm: new Date() })),
      validarReporte: vi.fn(() => ''),
      validarReporteParcial: vi.fn(() => ''),
      restaurarOperacaoAtiva: vi.fn(() => of(null)),
    };

    await TestBed.configureTestingModule({
      imports: [ReportOperacaoPage],
      providers: [
        { provide: Router, useValue: router },
        {
          provide: AuthSessionService,
          useValue: {
            session$,
            isAuthenticated: () => session$.value !== null,
            get currentUser() {
              return session$.value?.user ?? null;
            },
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
        { provide: ReportOperacaoService, useValue: service },
        { provide: ReportOperacaoWorkflowState, useValue: workflow },
        { provide: OperationalContextService, useValue: operationalContext },
        { provide: ReporteParadasService, useValue: stoppages },
        { provide: PoDialogService, useValue: dialog },
        {
          provide: PoNotificationService,
          useValue: notification,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportOperacaoPage);
    component = fixture.componentInstance;
    correctionContext = TestBed.inject(OperationalCorrectionContextService);
    const actualDialog = (component as unknown as { dialog: PoDialogService }).dialog;
    dialog = { confirm: vi.spyOn(actualDialog, 'confirm').mockImplementation(() => undefined) };
  });

  it('permite acesso direto sem depender de um catálogo de Áreas', () => {
    fixture.detectChanges();

    expect(service.listarAreasProducao).not.toHaveBeenCalled();
    expect(component.areas).toEqual([]);
    expect(component.areaCode).toBe('');
    expect(component.workCenterCode).toBe('');
    expect(component.feedback).toContain('Selecione');
  });

  it('mantém a Área vazia ao recarregar mesmo quando existe operação persistida', () => {
    service.restaurarOperacaoAtiva.mockReturnValue(of({
      area: { code: '4001', description: 'Produção' },
      workCenter: center(),
      operation: baseOperacao(),
      responsavel: { tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva' },
      reportes: [],
    }));

    fixture.detectChanges();

    expect(component.areaCode).toBe('');
    expect(component.workCenterCode).toBe('');
    expect(workflow.hasActiveWorkflow()).toBe(false);
  });

  it('transfere contexto estruturado para Paradas sem descartar o workflow ativo', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('001');
    component.iniciarOperacao();
    const before = workflow.snapshot();

    component.abrirParada();

    expect(stoppages.setPrefillContext).toHaveBeenCalledWith(expect.objectContaining({
      area: expect.objectContaining({ code: '4001' }),
      workCenter: expect.objectContaining({ code: 'CT-EXT-01' }),
      preferredResponsible: expect.objectContaining({
        tipo: 'OPERADOR',
        codigo: '001',
      }),
      origin: expect.objectContaining({
        type: 'OPERATION_REPORT',
        sourceRoute: '/operation-reporting',
      }),
    }));
    expect(router.navigate).toHaveBeenCalledWith(['/stoppages']);
    expect(workflow.snapshot()).toEqual(before);
  });

  it('preserva o workflow e remove somente o prefill quando a navegação para Paradas é recusada', async () => {
    router.navigate.mockResolvedValueOnce(false);
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('001');
    component.iniciarOperacao();
    const before = workflow.snapshot();

    component.abrirParada();
    await vi.waitFor(() => expect(stoppages.clearPrefillContext).toHaveBeenCalledOnce());

    expect(workflow.snapshot()).toEqual(before);
    expect(notification.error).toHaveBeenCalledWith(
      'Não foi possível abrir o reporte de Paradas.',
    );
  });

  it('prefills Area and Center from operational context without mutating it', () => {
    operationalContext.currentContext = context();

    fixture.detectChanges();

    expect(component.areaCode).toBe('4001');
    expect(component.workCenterCode).toBe('CT-EXT-01');
    expect(service.pesquisarCentrosTrabalho).toHaveBeenCalledWith('4001', '');
    expect(operationalContext.setContext).not.toHaveBeenCalled();
  });

  it('ignores a stale Center response after Area changes', () => {
    const first = new Subject<ReturnType<typeof center>[]>();
    vi.mocked(service.pesquisarCentrosTrabalho)
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValueOnce(of([]));
    fixture.detectChanges();

    component.onAreaChange('4001');
    component.onAreaChange('4002');
    first.next([center()]);

    expect(component.areaCode).toBe('4002');
    expect(component.centers).toEqual([]);
  });

  it('informa quando o código da Área não possui Centros disponíveis', () => {
    fixture.detectChanges();
    component.onAreaChange('4104');

    expect(service.pesquisarCentrosTrabalho).toHaveBeenCalledWith('4104', '');
    expect(component.contextError).toContain('não encontrada ou sem Centros');
    expect(notification.warning).toHaveBeenCalledWith(component.contextError);
  });

  it('retries the Center request that failed without losing the selected Area', () => {
    vi.mocked(service.pesquisarCentrosTrabalho)
      .mockReturnValueOnce(throwError(() => new Error('network')))
      .mockReturnValueOnce(of([center()]));
    fixture.detectChanges();

    component.onAreaChange('4001');
    expect(component.contextError).toContain('Centros');

    component.retryContext();

    expect(service.pesquisarCentrosTrabalho).toHaveBeenCalledTimes(2);
    expect(component.areaCode).toBe('4001');
    expect(component.centers).toEqual([center()]);
    expect(component.contextError).toBe('');
  });

  it('ignores a stale Orders response after a newer consultation completes', () => {
    const first = new Subject<OrdemCentroTrabalho[]>();
    vi.mocked(service.listarOrdensPorCentro)
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValueOnce(of([orders[1]]));
    fixture.detectChanges();
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');

    component.consultOrders();
    component.consultOrders();
    first.next([orders[0]]);

    expect(component.orders).toEqual([orders[1]]);
  });

  it('normalizes multiple selected IDs and loads only one order', () => {
    fixture.detectChanges();
    selectContextAndConsult();

    component.updateSelection(new Set(['second', 'first']));
    component.openSelectedOrders();

    expect(workflow.snapshot().queue.map(order => order.id)).toEqual(['first']);
    expect([...component.selectedOrderIds]).toEqual(['first']);
    expect(service.carregarOrdemSelecionada).toHaveBeenCalledTimes(1);
    expect(component.operacao?.ordem).toBe('450001');
    expect(component.estado).toBe(EstadoOperacao.OPEncontrada);
  });

  it('abre um split já iniciado diretamente para reporte com o início real', () => {
    const startedAt = new Date(2026, 7, 29);
    vi.mocked(service.carregarOrdemSelecionada).mockReturnValue(of({
      sucesso: true,
      operacao: baseOperacao({
        indReporteMod: 2,
        dataInicio: startedAt,
        horaInicio: '09:35',
      }),
    }));
    fixture.detectChanges();
    selectContextAndConsult();
    operationalContext.currentContext = context();
    component.updateSelection(new Set(['first']));

    component.openSelectedOrders();

    expect(component.estado).toBe(EstadoOperacao.OperacaoIniciada);
    expect(workflow.snapshot().operationState).toBe(EstadoOperacao.OperacaoIniciada);
    expect(component.dataInicioSelecionada).toEqual(startedAt);
    expect(component.horaInicioSelecionada).toBe('09:35');
    expect(component.iniciarDisabled).toBe(true);
    expect(component.reporteDisabled).toBe(false);
    expect(component.encerrarDisabled).toBe(false);
    expect(component.responsavelSelecionado).toEqual({
      tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva',
    });
    expect(component.feedback).toContain('já iniciada em 29/08/2026 às 09:35');
  });

  it('fixa o tipo Operador no modo 2 e mantém a escolha do operador habilitada', () => {
    vi.mocked(service.carregarOrdemSelecionada).mockReturnValue(of({
      sucesso: true, operacao: baseOperacaoComModo(2),
    }));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));

    component.openSelectedOrders();
    fixture.detectChanges();
    const card = fixture.debugElement.query(By.directive(OperacaoInfoCard))
      .componentInstance as OperacaoInfoCard;
    component.alterarTipoResponsavel('EQUIPE');

    expect(service.listarResponsaveis).toHaveBeenCalledWith('4001', 'CT-EXT-01', 'OPERADOR');
    expect(component.tipoResponsavel).toBe('OPERADOR');
    expect(component.responsavelCodigo).toBe('');
    expect((card as unknown as { tipoResponsavelDisabled: boolean }).tipoResponsavelDisabled).toBe(true);
    expect(card.responsavelDisabled).toBe(false);

    component.alterarResponsavel('001');
    expect(component.responsavelSelecionado).toEqual({
      tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva',
    });
  });

  it('fixa o tipo Equipe no modo 3 e mantém escolha e criação de equipe habilitadas', () => {
    vi.mocked(service.carregarOrdemSelecionada).mockReturnValue(of({
      sucesso: true, operacao: baseOperacaoComModo(3),
    }));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));

    component.openSelectedOrders();
    fixture.detectChanges();
    const card = fixture.debugElement.query(By.directive(OperacaoInfoCard))
      .componentInstance as OperacaoInfoCard;
    const drawer = fixture.debugElement.query(By.directive(GerenciarEquipeSlide))
      .componentInstance as GerenciarEquipeSlide;
    vi.spyOn(drawer, 'abrir').mockImplementation(() => undefined);
    component.alterarTipoResponsavel('OPERADOR');

    expect(service.listarResponsaveis).toHaveBeenCalledWith('4001', 'CT-EXT-01', 'EQUIPE');
    expect(component.tipoResponsavel).toBe('EQUIPE');
    expect(component.responsavelCodigo).toBe('');
    expect((card as unknown as { tipoResponsavelDisabled: boolean }).tipoResponsavelDisabled).toBe(true);
    expect(card.responsavelDisabled).toBe(false);
    expect(component.canManageTeam).toBe(true);

    component.abrirGerenciarEquipe();
    component.onEquipeSalva(resultadoEquipe(' nova01 ', 'nova'));
    expect(drawer.abrir).toHaveBeenCalled();
    expect(component.responsavelSelecionado).toEqual({
      tipo: 'EQUIPE', codigo: 'NOVA01', nome: 'Equipe Nova',
    });
  });

  it('retries a failed active-order load while preserving the queue', () => {
    vi.mocked(service.carregarOrdemSelecionada)
      .mockReturnValueOnce(throwError(() => new Error('network')))
      .mockReturnValueOnce(of({ sucesso: true, operacao: baseOperacao() }));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));

    component.openSelectedOrders();

    expect(component.operacao).toBeNull();
    expect(component.estado).toBe(EstadoOperacao.Erro);
    expect(workflow.snapshot().operationState).toBe(EstadoOperacao.Erro);
    expect(workflow.snapshot().activeOrder?.id).toBe('first');
    expect(component.contextError).toContain('nova tentativa');

    component.retryContext();

    expect(service.carregarOrdemSelecionada).toHaveBeenCalledTimes(2);
    expect(component.operacao?.ordem).toBe('450001');
    expect(component.estado).toBe(EstadoOperacao.OPEncontrada);
    expect(component.contextError).toBe('');
  });

  it('ignores a stale active-order response after a confirmed context change', () => {
    const first = new Subject<{ sucesso: boolean; operacao: ReportOperacao }>();
    vi.mocked(service.carregarOrdemSelecionada).mockReturnValueOnce(first.asObservable());
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();

    component.onAreaChange('4002');
    vi.mocked(dialog.confirm).mock.calls[0][0].confirm();
    first.next({ sucesso: true, operacao: baseOperacao() });

    expect(component.areaCode).toBe('4002');
    expect(component.operacao).toBeNull();
    expect(workflow.snapshot().activeOrder).toBeNull();
  });

  it('keeps the operation active and accumulates multiple partial reports', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(orders.map(order => order.id)));
    component.openSelectedOrders();
    const startedAt = new Date(2026, 6, 23, 8);
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: startedAt, horaInicio: '08:00' });

    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });
    component.salvarReporte({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 1,
      quantidadeRefugo: 0,
      refugoItens: [],
    });

    expect(service.reportarOperacao).toHaveBeenCalledTimes(2);
    expect(service.carregarOrdemSelecionada).toHaveBeenCalledTimes(1);
    expect(workflow.snapshot().activeOrder?.id).toBe('first');
    expect(component.operacao?.ordem).toBe('450001');
    expect(component.operacao?.quantidadeAprovada).toBe(3);
    expect(component.operacao?.quantidadeRetrabalho).toBe(1);
    expect(component.reportes).toHaveLength(2);
    const firstRequest = vi.mocked(service.reportarOperacao).mock.calls[0][0];
    const secondRequest = vi.mocked(service.reportarOperacao).mock.calls[1][0];
    expect(firstRequest.dataInicio).toEqual(startedAt);
    expect(secondRequest.dataInicio).toEqual(firstRequest.dataFim);
    expect(firstRequest).toMatchObject({
      tipoResponsavel: 'OPERADOR',
      codigoResponsavel: '001',
    });
    expect(router.navigate).not.toHaveBeenCalledWith(['/work-center']);
  });

  it('confirma recebimento quando a Outbox reconcilia SYNCED', () => {
    service.reportarOperacao.mockReturnValue(of({
      apontamentoId: 'APT-1',
      reportadoEm: new Date('2026-08-28T10:00:00-03:00'),
      delivery: { status: 'SYNCED', receipt },
    }));

    submitReport({ quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

    expect(notification.success).toHaveBeenCalledWith('Reporte enviado ao Datasul.');
    expect(component.reportes).toHaveLength(1);
  });

  it('avisa quando o reporte local ficou pendente', () => {
    service.reportarOperacao.mockReturnValue(of({
      apontamentoId: 'APT-1', reportadoEm: new Date(), delivery: { status: 'PENDING' },
    }));

    submitReport({ quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

    expect(notification.warning).toHaveBeenCalledWith(
      'Datasul indisponível — reporte salvo como pendente.',
    );
    expect(component.reportes).toHaveLength(1);
  });

  it('não cria outro comando quando o Datasul rejeita o reporte', () => {
    service.reportarOperacao.mockReturnValue(of({
      apontamentoId: 'APT-1',
      reportadoEm: new Date(),
      delivery: { status: 'ERROR', error: persistedError },
    }));
    const confirmarReporte = vi.fn();
    const informarErro = vi.fn();
    submitReport(
      { quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 0 },
      () => {
        (component as unknown as {
          reporteSlide: { confirmarReporte: typeof confirmarReporte; informarErro: typeof informarErro };
        }).reporteSlide = { confirmarReporte, informarErro };
      },
    );

    expect(service.reportarOperacao).toHaveBeenCalledOnce();
    expect(confirmarReporte).toHaveBeenCalledOnce();
    expect(informarErro).not.toHaveBeenCalled();
    expect(notification.error).toHaveBeenCalledWith(
      `${persistedError.userMessage} Abra o Centro de Sincronização para corrigir.`,
    );
    expect(component.reportes).toHaveLength(1);
    expect(component.reporteDisabled).toBe(true);

    correctionContext.activate({
      ownerId: '1',
      sourceLocalId: 'outro-reporte',
      commandType: 'REPORT_OPERATION',
      aggregateType: 'OPERATION',
      aggregateId: '450001|OP-10458|01',
      payloadSchemaVersion: 1,
      draft: {},
    });
    component.salvarReporte({
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
    });

    expect(service.reportarOperacao).toHaveBeenCalledOnce();
  });

  it.each(['SYNCED', 'PENDING'] as const)(
    'substitui semanticamente o ERROR pela correção %s e permite encerrar',
    (deliveryStatus) => {
      const ending = new Subject<{ apontamentoId: string; reportadoEm: Date }>();
      service.reportarOperacao
        .mockReturnValueOnce(of({
          apontamentoId: 'APT-ERROR',
          reportadoEm: new Date('2026-08-28T10:00:00.000Z'),
          delivery: { status: 'ERROR', error: persistedError },
        }))
        .mockReturnValueOnce(of({
          apontamentoId: 'APT-CORRECTION',
          supersedesLocalId: 'APT-ERROR',
          reportadoEm: new Date('2026-08-28T10:05:00.000Z'),
          delivery: deliveryStatus === 'SYNCED'
            ? { status: 'SYNCED', receipt }
            : { status: 'PENDING' },
        }));
      service.encerrarOperacao.mockReturnValue(ending);
      submitReport({ quantidadeAprovada: 10, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });
      expect(correctionContext.activate({
        ownerId: '1',
        sourceLocalId: 'APT-ERROR',
        commandType: 'REPORT_OPERATION',
        aggregateType: 'OPERATION',
        aggregateId: '450001|OP-10458|01',
        payloadSchemaVersion: 1,
        draft: {},
      })).toBe(true);

      component.salvarReporte({
        quantidadeAprovada: 4,
        quantidadeRetrabalho: 0,
        quantidadeRefugo: 0,
        finalizarSplit: true,
      });

      expect(service.reportarOperacao).toHaveBeenCalledTimes(2);
      expect(component.reportes).toEqual([
        expect.objectContaining({
          id: 'APT-CORRECTION',
          supersedesLocalId: 'APT-ERROR',
          quantidadeAprovada: 4,
          deliveryStatus,
        }),
      ]);
      expect(component.operacao?.quantidadeAprovada).toBe(4);
      expect(workflow.snapshot().reportes).toEqual([
        expect.objectContaining({ id: 'APT-CORRECTION', quantidadeAprovada: 4 }),
      ]);
      expect(service.encerrarOperacao).toHaveBeenCalledWith(expect.objectContaining({
        dependencyIds: ['APT-CORRECTION'],
      }));
      expect(component.reportes.some(report => report.deliveryStatus === 'ERROR')).toBe(false);
    },
  );

  it('accepts rework without a scrap reason', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' });

    component.salvarReporte({
      quantidadeAprovada: 0,
      quantidadeRetrabalho: 1,
      quantidadeRefugo: 0,
      refugoItens: [],
    });

    expect(service.reportarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeRetrabalho: 1,
      quantidadeRefugo: 0,
      refugoItens: [],
    }));
    expect(component.reportes).toHaveLength(1);
  });

  it('opens the final report capture when ending is confirmed', () => {
    const abrir = vi.fn();
    fixture.detectChanges();
    (component as unknown as { reporteSlide: { abrir: typeof abrir } }).reporteSlide = { abrir };
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00', quantidadeAprovada: 1 });

    component.solicitarEncerramento();
    vi.mocked(dialog.confirm).mock.calls[0][0].confirm();

    expect(abrir).toHaveBeenCalledWith(component.reportes, true);
    expect(service.encerrarOperacao).not.toHaveBeenCalled();
    expect(component.operacao).not.toBeNull();
  });

  it('captures the final report without closing the split and makes END depend on it', () => {
    const finalReport = new Subject<ReporteOperacaoResultado>();
    service.reportarOperacao.mockReturnValueOnce(finalReport);
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' });

    component.salvarReporte({
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      finalizarSplit: true,
    });
    component.areaCode = 'contexto-visual-obsoleto';
    finalReport.next({ apontamentoId: 'APT-1', reportadoEm: new Date(), delivery: { status: 'PENDING' } });
    finalReport.complete();

    expect(service.reportarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      areaCode: '4001',
      ct: 'CT-EXT-01',
      finalizarSplit: false,
    }));
    expect(service.encerrarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      ordem: '450001',
      op: 'OP-10458',
      split: '01',
      areaCode: '4001',
      ct: 'CT-EXT-01',
      dependencyIds: ['APT-1'],
    }));
  });

  it('keeps the split active when Datasul rejects the final report', () => {
    service.reportarOperacao.mockReturnValueOnce(of({
      apontamentoId: 'APT-1',
      reportadoEm: new Date(),
      delivery: { status: 'ERROR', error: persistedError },
    }));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' });

    component.salvarReporte({
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      finalizarSplit: true,
    });

    expect(service.encerrarOperacao).not.toHaveBeenCalled();
  });

  it('blocks manual finalization after a report was rejected by Datasul', () => {
    service.reportarOperacao
      .mockReturnValueOnce(of({
        apontamentoId: 'APT-ERROR',
        reportadoEm: new Date(),
        delivery: { status: 'ERROR', error: persistedError },
      }))
      .mockReturnValueOnce(of({
        apontamentoId: 'APT-FINAL',
        reportadoEm: new Date(),
        delivery: { status: 'PENDING' },
      }));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' });
    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });
    const confirmarReporte = vi.fn();
    const abrir = vi.fn(() => component.salvarReporte({
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      finalizarSplit: true,
    }));
    (component as unknown as {
      reporteSlide: { abrir: typeof abrir; confirmarReporte: typeof confirmarReporte };
    }).reporteSlide = { abrir, confirmarReporte };

    component.solicitarEncerramento();
    vi.mocked(dialog.confirm).mock.calls[0]?.[0].confirm();

    expect(abrir).not.toHaveBeenCalled();
    expect(service.encerrarOperacao).not.toHaveBeenCalled();
    expect(notification.error).toHaveBeenCalledWith(
      'Há um reporte rejeitado pelo Datasul. Abra o Centro de Sincronização para corrigir antes de encerrar a operação.',
    );
  });

  it('does not mutate Datasul while only opening repeated final-report confirmations', () => {
    const abrir = vi.fn();
    fixture.detectChanges();
    (component as unknown as { reporteSlide: { abrir: typeof abrir } }).reporteSlide = { abrir };
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' });

    component.solicitarEncerramento();
    component.solicitarEncerramento();
    vi.mocked(dialog.confirm).mock.calls[0][0].confirm();
    vi.mocked(dialog.confirm).mock.calls[1][0].confirm();

    expect(abrir).toHaveBeenCalledTimes(2);
    expect(service.encerrarOperacao).not.toHaveBeenCalled();
  });

  it('preserves operation, queue and history when a partial report fails', () => {
    vi.mocked(service.reportarOperacao).mockReturnValue(throwError(() => new Error('network')));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00', quantidadeAprovada: 1 });
    component.salvarReporte({
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 2,
      refugoItens: [{ codigo: '05', descricao: 'Borra', quantidade: 2 }],
    });

    expect(component.estado).toBe(EstadoOperacao.Erro);
    expect(component.operacao?.quantidadeRefugo).toBe(0);
    expect(workflow.snapshot().queue).toHaveLength(1);
    expect(workflow.snapshot().reportes).toHaveLength(0);
  });

  it('does not report an operation that has not been started', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();

    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

    expect(service.reportarOperacao).not.toHaveBeenCalled();
    expect(component.feedback).toContain('Inicie a operação');
  });

  it('keeps the drawer draft when partial validation rejects the balance', () => {
    vi.mocked(service.validarReporteParcial).mockReturnValue(
      'A quantidade acumulada não pode ultrapassar o saldo da OP.',
    );
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(2026, 6, 23, 8), horaInicio: '08:00' });
    const informarErro = vi.fn();
    (component as unknown as { reporteSlide: { informarErro: typeof informarErro } }).reporteSlide = { informarErro };

    component.salvarReporte({ quantidadeAprovada: 321, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

    expect(service.reportarOperacao).not.toHaveBeenCalled();
    expect(informarErro).toHaveBeenCalledWith('A quantidade acumulada não pode ultrapassar o saldo da OP.');
  });

  it('does not apply a stale partial-report response to another operation', () => {
    const pending = new Subject<ReporteOperacaoResultado>();
    vi.mocked(service.reportarOperacao).mockReturnValue(pending.asObservable());
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    const firstOperation = baseOperacao({ dataInicio: new Date(2026, 6, 23, 8), horaInicio: '08:00' });
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = firstOperation;
    workflow.setActiveOperation(firstOperation, EstadoOperacao.OperacaoIniciada);

    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });
    component.operacao = baseOperacao({ ordem: '450002', op: 'OP-10459' });
    pending.next({ apontamentoId: 'STALE', reportadoEm: new Date(2026, 6, 23, 9), delivery: { status: 'PENDING' } });

    expect(component.operacao.ordem).toBe('450002');
    expect(component.reportes).toEqual([]);
    expect(workflow.snapshot().operationState).toBe(EstadoOperacao.OperacaoIniciada);
  });

  it('keeps the recoverable workflow state while a partial report is pending', () => {
    const pending = new Subject<ReporteOperacaoResultado>();
    vi.mocked(service.reportarOperacao).mockReturnValue(pending.asObservable());
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    const operation = baseOperacao({ dataInicio: new Date(2026, 6, 23, 8), horaInicio: '08:00' });
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = operation;
    workflow.setActiveOperation(operation, EstadoOperacao.OperacaoIniciada);

    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });

    expect(component.estado).toBe(EstadoOperacao.Reportando);
    expect(workflow.snapshot().operationState).toBe(EstadoOperacao.OperacaoIniciada);
  });

  it('does not mutate the loaded operation when starting fails', () => {
    vi.mocked(service.iniciarOperacao).mockReturnValue(throwError(() => new Error('network')));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    const original = component.operacao;
    component.alterarTipoResponsavel('EQUIPE');
    component.alterarResponsavel('MONT03');

    component.iniciarOperacao();

    expect(component.operacao).toEqual(original);
    expect(workflow.snapshot().operation).toEqual(original);
    expect(component.estado).toBe(EstadoOperacao.Erro);
  });

  it('mostra o motivo do Datasul e não inicia a operação quando o split já foi iniciado', () => {
    service.iniciarOperacao.mockImplementation(request => of({
      dataInicio: request.dataInicio,
      horaInicio: request.horaInicio,
      idempotencyKey: request.idempotencyKey,
      delivery: {
        status: 'ERROR' as const,
        error: {
          code: 'DATASUL_COMMAND_REJECTED',
          category: 'VALIDATION' as const,
          userMessage: 'Split já iniciado.',
        },
      },
    }));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('001');
    const original = component.operacao;

    component.iniciarOperacao();

    expect(component.operacao).toEqual(original);
    expect(workflow.snapshot().operation).toEqual(original);
    expect(component.estado).toBe(EstadoOperacao.Erro);
    expect(component.feedback).toBe('Split já iniciado.');
    expect(notification.error).toHaveBeenCalledWith('Split já iniciado.');
    expect(notification.success).not.toHaveBeenCalledWith(
      'Salvo neste dispositivo — envio pendente.',
    );
  });

  it('asks before discarding an active workflow and preserves it until confirmation', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();

    expect(component.hasActiveWorkflow).toBe(true);
    component.onAreaChange('4002');

    expect(dialog.confirm).toHaveBeenCalled();
    expect(component.areaCode).toBe('4001');
    expect(workflow.snapshot().activeOrder?.id).toBe('first');

    vi.mocked(dialog.confirm).mock.calls[0][0].confirm();

    expect(component.areaCode).toBe('4002');
    expect(workflow.snapshot().activeOrder).toBeNull();
  });

  it('keeps context controls available for discard confirmation while blocking consultation', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    fixture.detectChanges();

    const card = fixture.debugElement.query(By.directive(ContextoProducaoSelector)).componentInstance as ContextoProducaoSelector;

    expect(card.disabled).toBe(false);
    expect(card.consultBlocked).toBe(true);
    expect(card.centerDisabled).toBe(false);
    expect(card.actionDisabled).toBe(true);
  });

  it('renders the start, report and end operation actions', () => {
    fixture.detectChanges();

    const actions = fixture.debugElement.queryAll(By.css('app-report-actions po-button'));
    expect(actions.map(action => action.attributes['p-label'])).toEqual([
      'Iniciar',
      'Reporte',
      'Encerrar',
    ]);
  });

  it('preserves a restored queue and exposes recovery when its Center is unavailable', () => {
    workflow.setContext({ code: '4001', description: 'Produção' }, center());
    workflow.setOrders(orders);
    workflow.setSelectedOrderIds(new Set(['first']));
    workflow.startQueue();
    vi.mocked(service.pesquisarCentrosTrabalho).mockReturnValue(of([]));

    fixture.detectChanges();

    expect(component.contextError).toContain('não está mais ativo ou disponível');
    expect(component.workCenterCode).toBe('CT-EXT-01');
    expect(workflow.snapshot().activeOrder?.id).toBe('first');
  });

  it('restores the active order and queue after returning from Stoppages', () => {
    workflow.setContext({ code: '4001', description: 'Produção' }, center());
    workflow.setOrders(orders);
    workflow.setSelectedOrderIds(new Set(orders.map(order => order.id)));
    workflow.startQueue();
    workflow.setResponsavel({ tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva' });
    workflow.setActiveOperation(baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' }), EstadoOperacao.OperacaoIniciada);
    workflow.addReporte({
      id: 'APT-RESTORED',
      idempotencyKey: 'restored-1',
      registradoEm: new Date(2026, 6, 23, 9),
      dataInicio: new Date(2026, 6, 23, 8),
      horaInicio: '08:00',
      dataFim: new Date(2026, 6, 23, 9),
      horaFim: '09:00',
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
    });

    fixture.detectChanges();

    expect(component.estado).toBe(EstadoOperacao.OperacaoIniciada);
    expect(component.operacao?.ordem).toBe('450001');
    expect(component.queueRemaining).toBe(1);
    expect(component.responsavelCodigo).toBe('001');
    expect(component.reportes.map(reporte => reporte.id)).toEqual(['APT-RESTORED']);
    expect(component.operacao?.quantidadeAprovada).toBe(2);
  });

  it('recovers a legacy transient workflow state when recreating the page', () => {
    vi.mocked(service.listarResponsaveis).mockReturnValue(of([]));
    workflow.setContext({ code: '4001', description: 'Produção' }, center());
    workflow.setOrders(orders);
    workflow.setSelectedOrderIds(new Set(['first']));
    workflow.startQueue();
    workflow.setResponsavel({ tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva' });
    workflow.setActiveOperation(
      baseOperacao({ dataInicio: new Date(2026, 6, 23, 8), horaInicio: '08:00' }),
      EstadoOperacao.Reportando,
    );

    fixture.detectChanges();

    expect(component.estado).toBe(EstadoOperacao.OperacaoIniciada);
    expect(workflow.snapshot().operationState).toBe(EstadoOperacao.OperacaoIniciada);
    expect(component.responsavelCodigo).toBe('001');
    expect(component.responsavelSelecionado).toEqual({
      tipo: 'OPERADOR',
      codigo: '001',
      nome: 'Ana Silva',
    });
    expect(component.reporteDisabled).toBe(false);
  });

  it('allows retrying an empty responsible list without reloading the page', () => {
    vi.mocked(service.listarResponsaveis)
      .mockReturnValueOnce(of([]))
      .mockReturnValueOnce(of([{ tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva' }]));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();

    expect(component.responsaveisError).toContain('Tente novamente');

    component.retryResponsaveis();

    expect(service.listarResponsaveis).toHaveBeenCalledTimes(2);
    expect(component.responsavelCodigo).toBe('001');
    expect(component.responsaveisError).toBe('');
  });

  it('sends only the incremental quantities in each report payload', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({
      dataInicio: new Date(2026, 5, 30),
      dataFim: new Date(2026, 5, 30),
      horaInicio: '08:00',
      horaFim: '08:30',
      quantidadeAprovada: 1,
    });
    component.salvarReporte({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0.5,
      quantidadeRefugo: 1.5,
      refugoItens: [
        { codigo: '05', descricao: 'Borra', quantidade: 1.5 },
      ],
    });

    expect(service.reportarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0.5,
      quantidadeRefugo: 1.5,
      refugoItens: [
        { codigo: '05', descricao: 'Borra', quantidade: 1.5 },
      ],
    }));
    expect(component.reportes[0]).toEqual(expect.objectContaining({
      quantidadeRefugo: 1.5,
      refugoItens: [
        { codigo: '05', descricao: 'Borra', quantidade: 1.5 },
      ],
    }));
    expect(component.operacao).toEqual(expect.objectContaining({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0.5,
      quantidadeRefugo: 1.5,
    }));
  });

  it('rejects a report containing more than one scrap or rework reason', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' });

    component.salvarReporte({
      quantidadeAprovada: 1,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 2,
      refugoItens: [
        { codigo: '05', descricao: 'Borra', quantidade: 1 },
        { codigo: '07', descricao: 'Outro', quantidade: 1 },
      ],
    });

    expect(service.reportarOperacao).not.toHaveBeenCalled();
    expect(component.feedback).toBe(
      'Informe exatamente um motivo de refugo para a Ordem 450001.',
    );
  });

  it('opens the unified report for scrap without mounting the scrap-only drawer', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({
      dataInicio: new Date(2026, 5, 30),
      horaInicio: '08:00',
    });
    const abrirReporte = vi.fn();
    (component as unknown as { reporteSlide: { abrir: typeof abrirReporte } }).reporteSlide = {
      abrir: abrirReporte,
    };

    component.abrirRefugo();

    expect(abrirReporte).toHaveBeenCalledWith([]);
    expect(component.feedback).toContain('quantidade de refugo');
    expect(fixture.nativeElement.querySelector('app-refugo-slide')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Editar Refugo');
  });

  it('requires a selected operator or team before starting and locks it after start', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('');

    expect(service.listarResponsaveis).toHaveBeenCalledWith('4001', 'CT-EXT-01');
    component.iniciarOperacao();

    expect(service.iniciarOperacao).not.toHaveBeenCalled();

    component.alterarResponsavel('001');
    component.iniciarOperacao();

    expect(service.iniciarOperacao).toHaveBeenCalledTimes(1);
    expect(service.iniciarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      tipoResponsavel: 'OPERADOR',
      codigoResponsavel: '001',
      operador: 'Ana Silva',
      equipe: '',
    }));
    expect(component.operacao?.dataInicio).toBeInstanceOf(Date);
    expect(component.iniciarDisabled).toBe(true);
    expect(component.reporteDisabled).toBe(false);
  });

  it('starts the operation with the date and time selected by the user', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('001');
    component.alterarDataInicio('2026-08-15');
    component.alterarHoraInicio('06:45');

    component.iniciarOperacao();

    expect(service.iniciarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      dataInicio: new Date(2026, 7, 15),
      horaInicio: '06:45',
    }));
  });

  it('abre a drawer contextual sem navegar e aplica criação por upsert com seleção automática', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarTipoResponsavel('EQUIPE');
    const before = workflow.snapshot();
    const drawer = fixture.debugElement.query(By.directive(GerenciarEquipeSlide))
      .componentInstance as GerenciarEquipeSlide;
    const abrir = vi.spyOn(drawer, 'abrir').mockImplementation(() => undefined);

    expect(component.canManageTeam).toBe(true);
    component.abrirGerenciarEquipe();

    expect(abrir).toHaveBeenCalledWith({
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      areaLabel: 'Producao',
      workCenterLabel: 'Extrusao Linha 01',
    }, 'nova');
    expect(router.navigate).not.toHaveBeenCalled();

    component.onEquipeSalva(resultadoEquipe(' nova01 ', 'nova'));
    component.onEquipeSalva(resultadoEquipe('NOVA01', 'nova'));

    expect(component.responsaveis.filter(item =>
      item.tipo === 'EQUIPE' && item.codigo === 'NOVA01')).toEqual([
      { tipo: 'EQUIPE', codigo: 'NOVA01', nome: 'Equipe Nova' },
    ]);
    expect(component.responsavelSelecionado).toEqual({
      tipo: 'EQUIPE',
      codigo: 'NOVA01',
      nome: 'Equipe Nova',
    });
    const after = workflow.snapshot();
    expect({
      area: after.area,
      workCenter: after.workCenter,
      orders: after.orders,
      selectedOrderIds: [...after.selectedOrderIds],
      queue: after.queue,
      activeOrder: after.activeOrder,
      operation: after.operation,
      operationState: after.operationState,
      scrapItems: after.scrapItems,
      lastScrapReason: after.lastScrapReason,
      reportes: after.reportes,
    }).toEqual({
      area: before.area,
      workCenter: before.workCenter,
      orders: before.orders,
      selectedOrderIds: [...before.selectedOrderIds],
      queue: before.queue,
      activeOrder: before.activeOrder,
      operation: before.operation,
      operationState: before.operationState,
      scrapItems: before.scrapItems,
      lastScrapReason: before.lastScrapReason,
      reportes: before.reportes,
    });
  });

  it('preserva o workflow em cancelamento e erro da drawer', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarTipoResponsavel('EQUIPE');
    const before = workflow.snapshot();
    const drawer = fixture.debugElement.query(By.directive(GerenciarEquipeSlide))
      .componentInstance as GerenciarEquipeSlide;

    drawer.cancelado.emit();
    drawer.state.set('error');
    drawer.errorKind.set('save');
    drawer.feedback.set('Falha temporária');

    expect(workflow.snapshot()).toEqual(before);
    expect(component.areaCode).toBe('4001');
    expect(component.workCenterCode).toBe('CT-EXT-01');
    expect(component.responsaveis).toEqual([
      { tipo: 'OPERADOR', codigo: '001', nome: 'Ana Silva' },
      { tipo: 'EQUIPE', codigo: 'MONT03', nome: 'Equipe A' },
    ]);
  });

  it('invalida resultado da drawer após troca de CT e retorno ao contexto original', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarTipoResponsavel('EQUIPE');
    component.centers = [
      center(),
      { ...center(), code: 'CT-EXT-02', description: 'Extrusora 02' },
    ];
    const drawer = fixture.debugElement.query(By.directive(GerenciarEquipeSlide))
      .componentInstance as GerenciarEquipeSlide;
    vi.spyOn(drawer, 'abrir').mockImplementation(() => undefined);
    component.abrirGerenciarEquipe();

    component.onWorkCenterChange('CT-EXT-02');
    const confirm = dialog.confirm.mock.calls.at(-1)?.[0].confirm as () => void;
    confirm();
    component.onWorkCenterChange('CT-EXT-01');
    component.onEquipeSalva(resultadoEquipe('NOVA01', 'nova'));

    expect(component.responsaveis).not.toContainEqual(expect.objectContaining({ codigo: 'NOVA01' }));
  });

  it('bloqueia início e ignora resultado de equipe enquanto há save ou início pendente', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarTipoResponsavel('EQUIPE');
    component.alterarResponsavel('MONT03');
    const drawer = fixture.debugElement.query(By.directive(GerenciarEquipeSlide))
      .componentInstance as GerenciarEquipeSlide;
    drawer.state.set('saving');

    expect(component.iniciarDisabled).toBe(true);
    component.iniciarOperacao();
    expect(service.iniciarOperacao).not.toHaveBeenCalled();

    drawer.state.set('closed');
    component.estado = EstadoOperacao.Carregando;
    component.onEquipeSalva(resultadoEquipe('NOVA01', 'nova'));
    expect(component.responsaveis).not.toContainEqual(expect.objectContaining({ codigo: 'NOVA01' }));
  });

  it('ignora resultado e consulta de responsáveis obsoletos após troca de contexto ou logout', () => {
    const pending = new Subject<ReadonlyArray<{
      tipo: 'OPERADOR' | 'EQUIPE';
      codigo: string;
      nome: string;
    }>>();
    vi.mocked(service.listarResponsaveis).mockReturnValue(pending.asObservable());
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarTipoResponsavel('EQUIPE');
    const drawer = fixture.debugElement.query(By.directive(GerenciarEquipeSlide))
      .componentInstance as GerenciarEquipeSlide;
    vi.spyOn(drawer, 'abrir').mockImplementation(() => undefined);
    component.abrirGerenciarEquipe();

    component.onAreaChange('4002');
    vi.mocked(dialog.confirm).mock.calls[0][0].confirm();
    session$.next(null);
    pending.next([{ tipo: 'EQUIPE', codigo: 'ANTIGA', nome: 'Antiga' }]);
    component.onEquipeSalva(resultadoEquipe('NOVA01', 'nova'));

    expect(component.responsaveis).not.toContainEqual(expect.objectContaining({ codigo: 'ANTIGA' }));
    expect(component.responsaveis).not.toContainEqual(expect.objectContaining({ codigo: 'NOVA01' }));
  });

  it('re-upserta edição por chave normalizada sem trocar uma seleção diferente', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('001');
    component.alterarTipoResponsavel('EQUIPE');
    const drawer = fixture.debugElement.query(By.directive(GerenciarEquipeSlide))
      .componentInstance as GerenciarEquipeSlide;
    vi.spyOn(drawer, 'abrir').mockImplementation(() => undefined);
    component.abrirGerenciarEquipe();
    component.alterarTipoResponsavel('OPERADOR');
    component.alterarResponsavel(' 001 ');

    component.onEquipeSalva(resultadoEquipe(' mont03 ', 'existente'));

    expect(component.responsaveis.filter(item =>
      item.tipo === 'EQUIPE' && item.codigo === 'MONT03')).toHaveLength(1);
    expect(component.responsavelSelecionado).toEqual({
      tipo: 'OPERADOR',
      codigo: '001',
      nome: 'Ana Silva',
    });
  });

  function selectContextAndConsult(): void {
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');
    component.consultOrders();
  }

  function submitReport(draft: {
    readonly quantidadeAprovada: number;
    readonly quantidadeRetrabalho: number;
    readonly quantidadeRefugo: number;
  }, beforeSubmit?: () => void): void {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('001');
    component.iniciarOperacao();
    beforeSubmit?.();
    component.salvarReporte(draft);
  }
});

function resultadoEquipe(
  codigo: string,
  modo: GerenciarEquipeResultado['modo'],
): GerenciarEquipeResultado {
  return {
    equipe: {
      codigo,
      descricao: 'Equipe Nova',
      turno: 'T1',
      operadores: [{ codigo: '001', nome: 'Ana Silva' }],
    },
    modo,
    contexto: {
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      areaLabel: 'Produção',
      workCenterLabel: 'Extrusao Linha 01',
    },
  };
}

function center() {
  return {
    code: 'CT-EXT-01',
    description: 'Extrusao Linha 01',
    areaCode: '4001',
    area: 'Producao',
    machineGroup: 'Extrusoras',
    establishment: '101',
    active: true,
  };
}

function context() {
  return {
    workCenter: center(),
    operator: { code: 'OP-001', name: 'Ana Silva', role: 'Operador', active: true },
    reportType: 'OPERATOR' as const,
    validity: '2026-07-23',
  };
}

function baseOperacao(overrides: Partial<ReportOperacao> = {}): ReportOperacao {
  return {
    ordem: '450001',
    op: 'OP-10458',
    split: '01',
    item: 'PERFIL-100',
    descricao: 'Perfil extrudado',
    unidade: 'PC',
    roteiro: '10 - Extrusão',
    quantidadeOrdem: 500,
    quantidadeSaldo: 320,
    linha: 'Extrusao Linha 01',
    horaInicio: '',
    horaFim: '',
    quantidadeAprovada: 0,
    quantidadeRetrabalho: 0,
    quantidadeRefugo: 0,
    ct: 'CT-EXT-01',
    grupoMaquina: 'Extrusoras',
    operador: 'Ana Silva',
    equipe: 'Equipe A',
    turno: '1o Turno',
    ...overrides,
  };
}

function baseOperacaoComModo(indReporteMod: unknown): ReportOperacao {
  return { ...baseOperacao(), indReporteMod } as ReportOperacao;
}
