import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PoDialogService, PoNotificationService } from '@po-ui/ng-components';

import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { ContextoProducaoCard } from '../../components/contexto-producao-card/contexto-producao-card';
import { EstadoOperacao, OrdemCentroTrabalho, ReportOperacao } from '../../models/report-operacao.model';
import { ReportOperacaoWorkflowState } from '../../services/report-operacao-workflow-state';
import { ReportOperacaoService } from '../../services/report-operacao.service';
import { ReportOperacaoPage } from './report-operacao-page';

describe('ReportOperacaoPage', () => {
  let fixture: ComponentFixture<ReportOperacaoPage>;
  let component: ReportOperacaoPage;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let dialog: { confirm: ReturnType<typeof vi.fn> };
  let workflow: ReportOperacaoWorkflowState;
  let operationalContext: { currentContext: ReturnType<typeof context> | null; setContext: ReturnType<typeof vi.fn> };
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
  };

  const orders: OrdemCentroTrabalho[] = [
    { id: 'first', ordem: '450001', itemOp: 'PERFIL-100 / OP-10458', operacao: '10', split: '01' },
    { id: 'second', ordem: '450002', itemOp: 'PERFIL-200 / OP-10459', operacao: '20', split: '01' },
  ];

  beforeEach(async () => {
    router = { navigate: vi.fn().mockResolvedValue(true) };
    dialog = { confirm: vi.fn() };
    workflow = new ReportOperacaoWorkflowState();
    operationalContext = { currentContext: null, setContext: vi.fn() };
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
      iniciarOperacao: vi.fn(request => of({ dataInicio: request.dataInicio, horaInicio: request.horaInicio })),
      reportarOperacao: vi.fn(() => of({ apontamentoId: 'APT-1', reportadoEm: new Date() })),
      encerrarOperacao: vi.fn(() => of({ apontamentoId: 'ENC-1', reportadoEm: new Date() })),
      validarReporte: vi.fn(() => ''),
      validarReporteParcial: vi.fn(() => ''),
    };

    await TestBed.configureTestingModule({
      imports: [ReportOperacaoPage],
      providers: [
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
        { provide: ReportOperacaoService, useValue: service },
        { provide: ReportOperacaoWorkflowState, useValue: workflow },
        { provide: OperationalContextService, useValue: operationalContext },
        { provide: ReporteParadasService, useValue: { setContextFromOperation: vi.fn() } },
        { provide: PoDialogService, useValue: dialog },
        {
          provide: PoNotificationService,
          useValue: {
            success: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            information: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportOperacaoPage);
    component = fixture.componentInstance;
    const actualDialog = (component as unknown as { dialog: PoDialogService }).dialog;
    dialog = { confirm: vi.spyOn(actualDialog, 'confirm').mockImplementation(() => undefined) };
  });

  it('loads Areas on direct access and requests the missing local context', () => {
    fixture.detectChanges();

    expect(component.areas.map(area => area.code)).toEqual(['4001', '4002']);
    expect(component.areaCode).toBe('');
    expect(component.workCenterCode).toBe('');
    expect(component.feedback).toContain('Selecione');
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

  it('ignores stale Area responses after a retry starts a newer request', () => {
    const first = new Subject<Array<{ code: string; description: string }>>();
    vi.mocked(service.listarAreasProducao)
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValueOnce(of([{ code: '4002', description: 'Qualidade' }]));

    fixture.detectChanges();
    component.retryContext();
    first.next([{ code: '4001', description: 'Produção' }]);

    expect(component.areas).toEqual([{ code: '4002', description: 'Qualidade' }]);
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

  it('consults, snapshots selected orders in table order and loads only the first', () => {
    fixture.detectChanges();
    selectContextAndConsult();

    component.updateSelection(new Set(['second', 'first']));
    component.openSelectedOrders();

    expect(workflow.snapshot().queue.map(order => order.id)).toEqual(['first', 'second']);
    expect(service.carregarOrdemSelecionada).toHaveBeenCalledTimes(1);
    expect(component.operacao?.ordem).toBe('450001');
    expect(component.estado).toBe(EstadoOperacao.OPEncontrada);
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
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00', quantidadeAprovada: 1 });

    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });
    component.salvarReporte({ quantidadeAprovada: 2, quantidadeRetrabalho: 1, quantidadeRefugo: 0 });

    expect(service.reportarOperacao).toHaveBeenCalledTimes(2);
    expect(service.carregarOrdemSelecionada).toHaveBeenCalledTimes(1);
    expect(workflow.snapshot().activeOrder?.id).toBe('first');
    expect(component.operacao?.ordem).toBe('450001');
    expect(component.operacao?.quantidadeAprovada).toBe(3);
    expect(component.operacao?.quantidadeRetrabalho).toBe(1);
    expect(component.reportes).toHaveLength(2);
    expect(router.navigate).not.toHaveBeenCalledWith(['/work-center']);
  });

  it('refreshes the Center list after confirming the last operation ending', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00', quantidadeAprovada: 1 });

    component.solicitarEncerramento();
    vi.mocked(dialog.confirm).mock.calls[0][0].confirm();

    expect(service.encerrarOperacao).toHaveBeenCalledTimes(1);
    expect(service.listarOrdensPorCentro).toHaveBeenCalledTimes(2);
    expect(component.operacao).toBeNull();
    expect(workflow.snapshot().activeOrder).toBeNull();
    expect(router.navigate).not.toHaveBeenCalledWith(['/work-center']);
  });

  it('preserves operation, queue and history when a partial report fails', () => {
    vi.mocked(service.reportarOperacao).mockReturnValue(throwError(() => new Error('network')));
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00', quantidadeAprovada: 1 });
    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 2 });

    expect(component.estado).toBe(EstadoOperacao.Erro);
    expect(component.operacao?.quantidadeRefugo).toBe(0);
    expect(workflow.snapshot().queue).toHaveLength(1);
    expect(workflow.snapshot().reportes).toHaveLength(0);
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

    const card = fixture.debugElement.query(By.directive(ContextoProducaoCard)).componentInstance as ContextoProducaoCard;

    expect(card.disabled).toBe(false);
    expect(card.consultBlocked).toBe(true);
    expect(card.centerDisabled).toBe(false);
    expect(card.consultDisabled).toBe(true);
  });

  it('renders exactly the three requested operation actions', () => {
    fixture.detectChanges();

    const actions = fixture.debugElement.queryAll(By.css('app-report-actions po-button'));
    expect(actions.map(action => action.attributes['p-label'])).toEqual(['Iniciar', 'Reporte', 'Encerrar']);
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
    workflow.setActiveOperation(baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' }), EstadoOperacao.OperacaoIniciada);

    fixture.detectChanges();

    expect(component.estado).toBe(EstadoOperacao.OperacaoIniciada);
    expect(component.operacao?.ordem).toBe('450001');
    expect(component.queueRemaining).toBe(2);
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
    });

    expect(service.reportarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0.5,
      quantidadeRefugo: 1.5,
    }));
  });

  it('requires a selected operator or team before starting and locks it after start', () => {
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.alterarResponsavel('');

    component.iniciarOperacao();

    expect(service.iniciarOperacao).not.toHaveBeenCalled();

    component.alterarResponsavel('001');
    component.iniciarOperacao();

    expect(service.iniciarOperacao).toHaveBeenCalledTimes(1);
    expect(component.operacao?.dataInicio).toBeInstanceOf(Date);
    expect(component.iniciarDisabled).toBe(true);
    expect(component.reporteDisabled).toBe(false);
  });

  function selectContextAndConsult(): void {
    component.onAreaChange('4001');
    component.onWorkCenterChange('CT-EXT-01');
    component.consultOrders();
  }
});

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
