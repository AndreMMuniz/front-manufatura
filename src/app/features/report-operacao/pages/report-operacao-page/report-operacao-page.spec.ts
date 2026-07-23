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
  let reportSequence: number;
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
    reportSequence = 0;
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
      reportarOperacao: vi.fn(() => {
        reportSequence += 1;
        return of({ apontamentoId: `APT-${reportSequence}`, reportadoEm: new Date() });
      }),
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
    const startedAt = new Date(2026, 6, 23, 8);
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: startedAt, horaInicio: '08:00' });

    component.salvarReporte({ quantidadeAprovada: 1, quantidadeRetrabalho: 0, quantidadeRefugo: 0 });
    component.salvarReporte({ quantidadeAprovada: 2, quantidadeRetrabalho: 1, quantidadeRefugo: 0 });

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

  it('ignores a second ending confirmation while the first request is pending', () => {
    const pending = new Subject<{ apontamentoId: string; reportadoEm: Date }>();
    vi.mocked(service.encerrarOperacao).mockReturnValue(pending.asObservable());
    fixture.detectChanges();
    selectContextAndConsult();
    component.updateSelection(new Set(['first']));
    component.openSelectedOrders();
    component.estado = EstadoOperacao.OperacaoIniciada;
    component.operacao = baseOperacao({ dataInicio: new Date(), horaInicio: '08:00' });

    component.solicitarEncerramento();
    component.solicitarEncerramento();
    vi.mocked(dialog.confirm).mock.calls[0][0].confirm();
    vi.mocked(dialog.confirm).mock.calls[1][0].confirm();

    expect(service.encerrarOperacao).toHaveBeenCalledTimes(1);
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
    const pending = new Subject<{ apontamentoId: string; reportadoEm: Date }>();
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
    pending.next({ apontamentoId: 'STALE', reportadoEm: new Date(2026, 6, 23, 9) });

    expect(component.operacao.ordem).toBe('450002');
    expect(component.reportes).toEqual([]);
    expect(workflow.snapshot().operationState).toBe(EstadoOperacao.OperacaoIniciada);
  });

  it('keeps the recoverable workflow state while a partial report is pending', () => {
    const pending = new Subject<{ apontamentoId: string; reportadoEm: Date }>();
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

  it('renders only the start and report operation actions', () => {
    fixture.detectChanges();

    const actions = fixture.debugElement.queryAll(By.css('app-report-actions po-button'));
    expect(actions.map(action => action.attributes['p-label'])).toEqual(['Iniciar', 'Reporte']);
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
    expect(component.queueRemaining).toBe(2);
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
    });

    expect(service.reportarOperacao).toHaveBeenCalledWith(expect.objectContaining({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0.5,
      quantidadeRefugo: 1.5,
      refugoItens: [],
    }));
    expect(component.reportes[0]).toEqual(expect.objectContaining({
      quantidadeRefugo: 1.5,
      refugoItens: [],
    }));
    expect(component.operacao).toEqual(expect.objectContaining({
      quantidadeAprovada: 2,
      quantidadeRetrabalho: 0.5,
      quantidadeRefugo: 1.5,
    }));
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
