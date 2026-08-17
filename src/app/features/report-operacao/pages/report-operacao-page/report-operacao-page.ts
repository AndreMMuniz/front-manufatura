import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import {
  PoButtonModule,
  PoDialogService,
  PoNotificationService,
  PoPageModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import { IdempotencyService } from '../../../../core/offline/services/idempotency.service';
import { LoadingIndicator } from '../../../../shared/components/loading-indicator/loading-indicator';
import {
  OperationalCorrectionNotice,
} from '../../../../core/offline/components/operational-correction-notice/operational-correction-notice';
import {
  GerenciarEquipeResultado,
  GerenciarEquipeSlide,
} from '../../../equipes/components/gerenciar-equipe-slide/gerenciar-equipe-slide';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { ContextoProducaoSelector } from '../../../shop-floor/components/contexto-producao-selector/contexto-producao-selector';
import { AreaProducao } from '../../../shop-floor/models/production-area';
import { WorkCenter } from '../../../shop-floor/models/work-center';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import {
  RecentProductionContext,
  RecentProductionContextService,
} from '../../../shop-floor/services/recent-production-context.service';
import { OpDetalhesCard } from '../../components/op-detalhes-card/op-detalhes-card';
import { OperacaoInfoCard } from '../../components/operacao-info-card/operacao-info-card';
import { OrdensCentroList } from '../../components/ordens-centro-list/ordens-centro-list';
import { ProducaoForm } from '../../components/producao-form/producao-form';
import { ReporteParcialDraft, ReporteSlide } from '../../components/reporte-slide/reporte-slide';
import { ReportActions } from '../../components/report-actions/report-actions';
import { ReportarOperacaoRequest } from '../../interfaces/report-operacao.dto';
import {
  EstadoConsultaOrdens,
  EstadoOperacao,
  OrdemCentroTrabalho,
  ReportOperacao,
  ReporteParcialOperacao,
  ResponsavelOperacao,
  TipoResponsavelOperacao,
} from '../../models/report-operacao.model';
import { ReportOperacaoWorkflowState } from '../../services/report-operacao-workflow-state';
import { ReportOperacaoService } from '../../services/report-operacao.service';

@Component({
  selector: 'app-report-operacao-page',
  imports: [
    ContextoProducaoSelector,
    OpDetalhesCard,
    OperacaoInfoCard,
    OrdensCentroList,
    ProducaoForm,
    ReporteSlide,
    ReportActions,
    GerenciarEquipeSlide,
    PoButtonModule,
    PoPageModule,
    PoWidgetModule,
    OperationalCorrectionNotice,
    LoadingIndicator,
  ],
  templateUrl: './report-operacao-page.html',
  styleUrls: ['./report-operacao-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportOperacaoPage implements OnInit {
  @ViewChild(ReporteSlide) private reporteSlide?: ReporteSlide;
  @ViewChild(GerenciarEquipeSlide) private gerenciarEquipeSlide?: GerenciarEquipeSlide;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reportOperacaoService = inject(ReportOperacaoService);
  private readonly workflowState = inject(ReportOperacaoWorkflowState);
  private readonly operationalContext = inject(OperationalContextService);
  private readonly recentContextService = inject(RecentProductionContextService);
  private readonly authSession = inject(AuthSessionService);
  private readonly idempotency = inject(IdempotencyService);
  private readonly reporteParadasService = inject(ReporteParadasService);
  private readonly notification = inject(PoNotificationService);
  private readonly dialog = inject(PoDialogService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auxiliaryFlow = this.route.snapshot.data['auxiliaryFlow'];

  readonly pageTitle = this.auxiliaryFlow === 'refugo' ? 'Refugo / Retrabalho' : '';

  areas: ReadonlyArray<AreaProducao> = [];
  recentContexts: ReadonlyArray<RecentProductionContext> = [];
  centers: ReadonlyArray<WorkCenter> = [];
  orders: ReadonlyArray<OrdemCentroTrabalho> = [];
  selectedOrderIds: ReadonlySet<string> = new Set<string>();
  areaCode = '';
  workCenterCode = '';
  consultaEstado: EstadoConsultaOrdens = 'contexto-pendente';
  estado = EstadoOperacao.SemOP;
  operacao: ReportOperacao | null = null;
  feedback = 'Selecione a Área de Produção e o Centro de Trabalho para consultar as ordens.';
  contextError = '';
  isLoadingCenters = false;
  responsaveis: ReadonlyArray<ResponsavelOperacao> = [];
  tipoResponsavel: TipoResponsavelOperacao = 'OPERADOR';
  responsavelCodigo = '';
  reportes: ReadonlyArray<ReporteParcialOperacao> = [];
  encerrando = false;
  loadingResponsaveis = false;
  responsaveisError = '';
  dataInicioSelecionada: Date | string | null = null;
  horaInicioSelecionada = '';

  private areasRequest = 0;
  private centersRequest = 0;
  private ordersRequest = 0;
  private operationRequest = 0;
  private startRequest = 0;
  private reportRequest = 0;
  private endRequest = 0;
  private startIdempotencyKey = '';
  private endIdempotencyKey = '';
  private responsaveisRequest = 0;
  private teamGeneration = 0;
  private activeTeamContext: {
    readonly generation: number;
    readonly areaCode: string;
    readonly workCenterCode: string;
  } | null = null;
  private retryTarget: 'areas' | 'centers' | 'orders' | 'active-order' | null = null;

  get loadingAreas(): boolean {
    return this.consultaEstado === 'carregando-areas';
  }

  get loadingCenters(): boolean {
    return this.isLoadingCenters;
  }

  get loadingOrders(): boolean {
    return this.consultaEstado === 'consultando-ordens';
  }

  get loadingOperation(): boolean {
    return this.consultaEstado === 'carregando-ordem';
  }

  get showOrderList(): boolean {
    return !this.workflowState.hasActiveWorkflow()
      && ['ordens-disponiveis', 'lista-vazia', 'consultando-ordens'].includes(this.consultaEstado);
  }

  get hasActiveWorkflow(): boolean {
    return this.workflowState.hasActiveWorkflow();
  }

  get queueRemaining(): number {
    return this.workflowState.snapshot().queue.length;
  }

  get isBusy(): boolean {
    return this.loadingAreas || this.loadingOrders || this.loadingOperation
      || this.estado === EstadoOperacao.Carregando || this.estado === EstadoOperacao.Reportando;
  }

  get canEditProduction(): boolean {
    return this.estado === EstadoOperacao.OperacaoIniciada
      || (this.estado === EstadoOperacao.Erro && Boolean(this.operacao?.dataInicio));
  }

  get canOpenAuxiliaryFlows(): boolean {
    return this.canEditProduction;
  }

  get responsavelSelecionado(): ResponsavelOperacao | null {
    const codigo = this.normalizeCode(this.responsavelCodigo);
    return this.responsaveis.find(
      responsavel =>
        responsavel.tipo === this.tipoResponsavel
        && this.normalizeCode(responsavel.codigo) === codigo,
    ) ?? null;
  }

  get canManageTeam(): boolean {
    const area = this.areas.find(item =>
      this.normalizeCode(item.code) === this.normalizeCode(this.areaCode));
    const center = this.centers.find(item =>
      this.normalizeCode(item.code) === this.normalizeCode(this.workCenterCode));
    return this.authSession.isAuthenticated()
      && this.tipoResponsavel === 'EQUIPE'
      && !this.responsavelDefinidoPelaApi
      && Boolean(area)
      && Boolean(
        center
        && center.active
        && this.normalizeCode(center.areaCode) === this.normalizeCode(area?.code ?? ''),
      )
      && !this.operacao?.dataInicio
      && !this.isBusy
      && !this.loadingCenters
      && !this.loadingResponsaveis
      && this.gerenciarEquipeSlide?.state() !== 'saving';
  }

  get responsavelDefinidoPelaApi(): boolean {
    return this.operacao?.indReporteMod === 2 || this.operacao?.indReporteMod === 3;
  }

  get iniciarDisabled(): boolean {
    const podeIniciar =
      this.estado === EstadoOperacao.OPEncontrada
      || (this.estado === EstadoOperacao.Erro && !this.operacao?.dataInicio);
    return this.isBusy
      || this.gerenciarEquipeSlide?.state() === 'saving'
      || !this.operacao
      || !this.responsavelSelecionado
      || !this.normalizarDataInicio(this.dataInicioSelecionada)
      || !this.horaInicioValida(this.horaInicioSelecionada)
      || !podeIniciar;
  }

  get reporteDisabled(): boolean {
    return this.isBusy || !this.canEditProduction;
  }

  get encerrarDisabled(): boolean {
    return this.isBusy || !this.canEditProduction;
  }

  ngOnInit(): void {
    this.authSession.session$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(session => {
        if (session === null) {
          this.invalidateTeamContext();
        }
      });
    this.destroyRef.onDestroy(() => this.invalidateTeamContext());
    const snapshot = this.workflowState.snapshot();
    this.hydrate(snapshot);
    const restoreOperation =
      this.reportOperacaoService.restaurarOperacaoAtiva?.bind(this.reportOperacaoService);
    if (!snapshot.operation && restoreOperation) {
      restoreOperation()
        .pipe(catchError(() => of(null)))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(restored => {
          if (!restored || this.workflowState.snapshot().operation) return;
          const activeOrder: OrdemCentroTrabalho = {
            id: [
              restored.workCenter.code,
              restored.operation.ordem,
              restored.operation.op,
              restored.operation.split,
            ].join('|'),
            ordem: restored.operation.ordem,
            itemOp: `${restored.operation.item} / ${restored.operation.op}`,
            operacao: restored.operation.op,
            split: restored.operation.split,
          };
          this.workflowState.restore({
            ...this.workflowState.snapshot(),
            area: restored.area,
            workCenter: restored.workCenter,
            orders: [activeOrder],
            selectedOrderIds: new Set([activeOrder.id]),
            queue: [activeOrder],
            activeOrder,
            operation: restored.operation,
            operationState: EstadoOperacao.OperacaoIniciada,
            responsavel: restored.responsavel,
            reportes: restored.reportes,
          });
          this.hydrate(this.workflowState.snapshot());
          this.applyInitialContext();
          this.changeDetector.markForCheck();
        });
    }
    this.recentContexts = this.recentContextService.list();
    this.applyInitialContext();
    if (snapshot.operation) {
      this.loadResponsaveis();
    }
  }

  onAreaChange(code: string): void {
    const apply = () => {
      this.applyAreaChange(code);
      if (this.areaCode) {
        this.loadCenters(this.areaCode);
      }
    };
    this.confirmDiscardIfRequired(apply);
  }

  onAreaInput(code: string): void {
    const apply = () => this.applyAreaChange(code);
    this.confirmDiscardIfRequired(apply);
  }

  validateArea(code: string, prefillCode = ''): void {
    const normalized = this.normalizeCode(code);
    if (!normalized) {
      this.applyAreaChange('');
      return;
    }
    if (normalized !== this.areaCode) {
      this.applyAreaChange(normalized);
    }
    this.loadCenters(normalized, prefillCode);
  }

  selectRecentContext(context: RecentProductionContext): void {
    const apply = () => {
      this.applyAreaChange(context.areaCode);
      this.loadCenters(context.areaCode);
    };
    this.confirmDiscardIfRequired(apply);
  }

  onWorkCenterChange(code: string): void {
    const apply = () => this.applyWorkCenterChange(code);
    this.confirmDiscardIfRequired(apply);
  }

  consultOrders(): void {
    const area = this.areas.find(item => item.code === this.areaCode) ?? null;
    const center = this.centers.find(item => item.code === this.workCenterCode) ?? null;

    if (!area || !center || center.areaCode !== area.code || !center.active) {
      this.contextError = 'Selecione uma Área e um Centro de Trabalho válidos.';
      this.feedback = this.contextError;
      this.notification.warning(this.contextError);
      this.changeDetector.markForCheck();
      return;
    }

    this.workflowState.setContext(area, center);
    this.loadOrders(area, center);
  }

  retryContext(): void {
    const activeOrder = this.workflowState.snapshot().activeOrder;

    if (this.retryTarget === 'active-order' && activeOrder) {
      this.loadActiveOrder(activeOrder);
      return;
    }

    if (this.retryTarget === 'centers' && this.areaCode) {
      this.loadCenters(this.areaCode, this.workCenterCode, this.hasActiveWorkflow);
      return;
    }

    if (this.retryTarget === 'orders') {
      this.consultOrders();
      return;
    }

    if (this.areaCode && this.workCenterCode) {
      this.consultOrders();
      return;
    }

    this.validateArea(this.areaCode, this.workCenterCode);
  }

  updateSelection(ids: ReadonlySet<string>): void {
    const selectedOrder = this.orders.find(order => ids.has(order.id));
    this.selectedOrderIds = new Set(selectedOrder ? [selectedOrder.id] : []);
    this.workflowState.setOrders(this.orders);
    this.workflowState.setSelectedOrderIds(this.selectedOrderIds);
  }

  openSelectedOrders(): void {
    if (this.selectedOrderIds.size !== 1) {
      return;
    }

    this.workflowState.setOrders(this.orders);
    this.workflowState.setSelectedOrderIds(this.selectedOrderIds);
    const active = this.workflowState.startQueue();

    if (active) {
      this.loadActiveOrder(active);
    }
  }

  iniciarOperacao(): void {
    if (this.iniciarDisabled) {
      if (this.operacao && !this.responsavelSelecionado) {
        this.feedback = 'Selecione uma equipe ou um operador antes de iniciar.';
        this.notification.warning(this.feedback);
      } else if (
        this.operacao
        && (!this.normalizarDataInicio(this.dataInicioSelecionada)
          || !this.horaInicioValida(this.horaInicioSelecionada))
      ) {
        this.feedback = 'Informe uma data e uma hora de início válidas.';
        this.notification.warning(this.feedback);
      }
      return;
    }

    this.startOperation();
  }

  abrirReporte(): void {
    if (!this.reporteDisabled) {
      this.reporteSlide?.abrir(this.reportes);
    }
  }

  alterarTipoResponsavel(tipo: TipoResponsavelOperacao): void {
    if (this.responsavelDefinidoPelaApi || this.operacao?.dataInicio || this.isBusy) {
      return;
    }

    this.tipoResponsavel = tipo;
    this.responsavelCodigo = '';
    this.workflowState.setResponsavel(null);
  }

  alterarResponsavel(codigo: string): void {
    if (this.responsavelDefinidoPelaApi || this.operacao?.dataInicio || this.isBusy) {
      return;
    }

    this.responsavelCodigo = this.normalizeCode(codigo ?? '');
    this.workflowState.setResponsavel(this.responsavelSelecionado);
  }

  alterarDataInicio(dataInicio: Date | string | null): void {
    if (this.operacao?.dataInicio || this.isBusy) return;
    this.dataInicioSelecionada = dataInicio;
  }

  alterarHoraInicio(horaInicio: string): void {
    if (this.operacao?.dataInicio || this.isBusy) return;
    this.horaInicioSelecionada = horaInicio;
  }

  abrirGerenciarEquipe(acionador?: HTMLElement | null): void {
    if (!this.canManageTeam) {
      return;
    }
    const area = this.areas.find(item =>
      this.normalizeCode(item.code) === this.normalizeCode(this.areaCode));
    const center = this.centers.find(item =>
      this.normalizeCode(item.code) === this.normalizeCode(this.workCenterCode));
    if (!area || !center) {
      return;
    }

    const generation = ++this.teamGeneration;
    this.activeTeamContext = {
      generation,
      areaCode: this.normalizeCode(area.code),
      workCenterCode: this.normalizeCode(center.code),
    };
    const contexto = {
      areaCode: this.normalizeCode(area.code),
      workCenterCode: this.normalizeCode(center.code),
      areaLabel: area.description,
      workCenterLabel: center.description,
    };
    if (acionador) {
      this.gerenciarEquipeSlide?.abrir(contexto, 'nova', acionador);
    } else {
      this.gerenciarEquipeSlide?.abrir(contexto, 'nova');
    }
  }

  onEquipeSalva(resultado: GerenciarEquipeResultado): void {
    const active = this.activeTeamContext;
    const areaCode = this.normalizeCode(resultado.contexto.areaCode);
    const workCenterCode = this.normalizeCode(resultado.contexto.workCenterCode);
    if (
      !active
      || active.generation !== this.teamGeneration
      || active.areaCode !== areaCode
      || active.workCenterCode !== workCenterCode
      || this.normalizeCode(this.areaCode) !== areaCode
      || this.normalizeCode(this.workCenterCode) !== workCenterCode
      || !this.authSession.isAuthenticated()
      || this.isBusy
      || Boolean(this.operacao?.dataInicio)
      || this.responsavelDefinidoPelaApi
    ) {
      return;
    }

    const equipe: ResponsavelOperacao = {
      tipo: 'EQUIPE',
      codigo: this.normalizeCode(resultado.equipe.codigo),
      nome: resultado.equipe.descricao,
    };
    const key = this.responsavelKey(equipe);
    const selectedBefore = this.responsavelSelecionado;
    const merged = new Map<string, ResponsavelOperacao>();
    for (const responsavel of this.responsaveis) {
      const canonical = {
        ...responsavel,
        codigo: this.normalizeCode(responsavel.codigo),
      };
      merged.set(this.responsavelKey(canonical), canonical);
    }
    merged.set(key, equipe);
    this.responsaveis = [...merged.values()].map(item => ({ ...item }));

    if (
      resultado.modo === 'nova'
      || (resultado.modo === 'existente' && selectedBefore
        && this.responsavelKey(selectedBefore) === key)
    ) {
      this.tipoResponsavel = 'EQUIPE';
      this.responsavelCodigo = equipe.codigo;
      this.workflowState.setResponsavel(equipe);
    } else {
      this.workflowState.setResponsavel(selectedBefore);
    }
    this.changeDetector.markForCheck();
  }

  salvarReporte(draft: ReporteParcialDraft): void {
    this.reportOperation(draft);
  }

  solicitarEncerramento(): void {
    if (this.encerrando || this.encerrarDisabled) {
      return;
    }

    this.dialog.confirm({
      title: 'Encerrar operação?',
      message: 'O próximo reporte será o último e finalizará o split. Deseja informar as quantidades finais?',
      confirm: () => this.reporteSlide?.abrir(this.reportes, true),
      literals: { cancel: 'Cancelar', confirm: 'Informar reporte final' },
    });
  }

  retryResponsaveis(): void {
    if (!this.loadingResponsaveis && this.operacao) {
      this.loadResponsaveis();
    }
  }

  abrirRefugo(): void {
    if (this.reporteDisabled) {
      return;
    }

    this.abrirReporte();
    this.feedback = 'Informe a quantidade de refugo no reporte em edição.';
    this.notification.information(this.feedback);
  }

  abrirRetrabalho(): void {
    this.abrirReporte();
    this.feedback = 'Informe a quantidade de retrabalho no reporte em edição.';
    this.notification.information(this.feedback);
  }

  abrirParada(): void {
    if (!this.operacao || !this.canOpenAuxiliaryFlows) {
      return;
    }

    this.workflowState.setActiveOperation(this.operacao, this.estado);
    this.feedback = 'Abrindo reporte de paradas com o contexto da operação.';
    const area = this.areas.find(item => item.code === this.areaCode);
    const workCenter = this.centers.find(item => item.code === this.workCenterCode);
    const responsible = this.responsaveis.find(item =>
      item.tipo === this.tipoResponsavel && item.codigo === this.responsavelCodigo,
    );
    if (!area || !workCenter || !responsible) {
      return;
    }
    this.reporteParadasService.setPrefillContext({
      area,
      workCenter,
      origin: {
        type: 'OPERATION_REPORT',
        sourceRoute: '/operation-reporting',
        reportId: `${this.operacao.ordem}-${this.operacao.op}-${this.operacao.split}`,
      },
      preferredResponsible: responsible,
      metadata: {
        shift: this.operacao.turno,
        machineGroup: this.operacao.grupoMaquina,
      },
    });
    void this.router.navigate(['/stoppages'])
      .then(navigated => {
        if (!navigated) {
          this.rollbackStopNavigation();
        }
      })
      .catch(() => this.rollbackStopNavigation());
  }

  voltar(): void {
    this.endFlowAndNavigate('/work-center');
  }

  sair(): void {
    this.endFlowAndNavigate('/quality-control');
  }

  private rollbackStopNavigation(): void {
    this.reporteParadasService.clearPrefillContext();
    this.feedback = 'Não foi possível abrir o reporte de Paradas.';
    this.notification.error(this.feedback);
    this.changeDetector.markForCheck();
  }

  private applyInitialContext(): void {
    const snapshot = this.workflowState.snapshot();
    const contextCenter = snapshot.workCenter ?? this.operationalContext.currentContext?.workCenter ?? null;
    const areaCode = snapshot.area?.code ?? contextCenter?.areaCode ?? '';
    if (!areaCode || !contextCenter) {
      return;
    }

    this.areaCode = areaCode;
    this.loadCenters(areaCode, contextCenter.code, true);
  }

  private applyAreaChange(code: string): void {
    const normalized = this.normalizeCode(code);
    this.invalidateRequests();
    this.areaCode = normalized;
    this.areas = [];
    this.workCenterCode = '';
    this.centers = [];
    this.orders = [];
    this.selectedOrderIds = new Set<string>();
    this.clearActiveOperation();
    this.contextError = '';
    this.consultaEstado = 'contexto-pendente';
    this.workflowState.setContext(null, null);
    this.feedback = normalized
      ? 'Valide a Área de Produção para carregar os Centros de Trabalho.'
      : 'Digite a Área de Produção e selecione o Centro de Trabalho para consultar as ordens.';

    this.changeDetector.markForCheck();
  }

  private loadCenters(areaCode: string, prefillCode = '', preserveWorkflow = false): void {
    const request = ++this.centersRequest;
    this.isLoadingCenters = true;
    this.contextError = '';
    this.retryTarget = null;
    this.reportOperacaoService.pesquisarCentrosTrabalho(areaCode, '')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: centers => {
          if (request !== this.centersRequest || this.areaCode !== areaCode) return;
          this.isLoadingCenters = false;
          this.centers = centers.map(center => ({ ...center }));
          if (!this.centers.length) {
            const restoredArea = this.workflowState.snapshot().area;
            this.areas = preserveWorkflow && restoredArea ? [{ ...restoredArea }] : [];
            if (!preserveWorkflow) {
              this.workCenterCode = '';
              this.workflowState.setContext(null, null);
            }
            this.consultaEstado = 'erro';
            this.retryTarget = 'centers';
            this.contextError = preserveWorkflow
              ? 'O Centro de Trabalho restaurado não está mais ativo ou disponível.'
              : `Área de Produção ${areaCode} não encontrada ou sem Centros de Trabalho disponíveis.`;
            this.feedback = this.contextError;
            this.notification.warning(this.contextError);
            this.changeDetector.markForCheck();
            return;
          }
          const firstCenter = this.centers[0];
          const area: AreaProducao = {
            code: areaCode,
            description: firstCenter.area || `Área ${areaCode}`,
          };
          this.areas = [area];
          this.consultaEstado = 'pronto';
          if (!preserveWorkflow) {
            this.workflowState.setContext(area, null);
          }
          const prefill = this.centers.find(center => center.code === prefillCode) ?? null;
          if (prefill) {
            this.workCenterCode = prefill.code;
            if (!preserveWorkflow) {
              this.workflowState.setContext(area, prefill);
            }
            this.feedback = this.workflowState.hasActiveWorkflow()
              ? 'Apontamento restaurado.'
              : 'Centro de Trabalho preenchido. Consulte as ordens liberadas.';
          } else if (prefillCode) {
            this.retryTarget = 'centers';
            this.contextError = 'O Centro de Trabalho restaurado não está mais ativo ou disponível.';
            this.feedback = this.contextError;
            if (!preserveWorkflow) {
              this.workCenterCode = '';
              this.workflowState.setContext(area, null);
            }
          }
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (request !== this.centersRequest) return;
          this.isLoadingCenters = false;
          this.areas = [];
          this.centers = [];
          this.retryTarget = 'centers';
          this.contextError = 'Não foi possível carregar os Centros de Trabalho.';
          this.feedback = this.contextError;
          this.notification.error(this.contextError);
          this.changeDetector.markForCheck();
        },
      });
  }

  private applyWorkCenterChange(code: string): void {
    const center = this.centers.find(item => item.code === code && item.areaCode === this.areaCode && item.active) ?? null;
    const area = this.areas.find(item => item.code === this.areaCode) ?? null;
    this.invalidateTeamContext();
    this.responsaveisRequest += 1;
    this.loadingResponsaveis = false;
    this.ordersRequest += 1;
    this.operationRequest += 1;
    this.workCenterCode = center?.code ?? '';
    this.orders = [];
    this.selectedOrderIds = new Set<string>();
    this.clearActiveOperation();
    this.contextError = '';
    this.consultaEstado = area ? 'pronto' : 'contexto-pendente';
    this.workflowState.setContext(area, center);
    this.feedback = center
      ? 'Centro de Trabalho selecionado. Consulte as ordens liberadas.'
      : 'Selecione um Centro de Trabalho válido.';
    this.changeDetector.markForCheck();
  }

  private loadOrders(area: AreaProducao, center: WorkCenter): void {
    const request = ++this.ordersRequest;
    this.consultaEstado = 'consultando-ordens';
    this.contextError = '';
    this.retryTarget = null;
    this.feedback = 'Consultando ordens liberadas no Datasul...';

    this.reportOperacaoService.listarOrdensPorCentro(area.code, center.code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: orders => {
          if (request !== this.ordersRequest || this.areaCode !== area.code || this.workCenterCode !== center.code) return;
          this.orders = orders.map(order => ({ ...order }));
          this.selectedOrderIds = new Set<string>();
          this.workflowState.setOrders(this.orders);
          this.workflowState.setSelectedOrderIds(this.selectedOrderIds);
          this.consultaEstado = orders.length ? 'ordens-disponiveis' : 'lista-vazia';
          this.feedback = orders.length
            ? `${orders.length} ordem(ns) liberada(s) encontrada(s).`
            : 'Nenhuma ordem liberada para este Centro de Trabalho.';
          this.recentContextService.remember(area.code);
          this.recentContexts = this.recentContextService.list();
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (request !== this.ordersRequest) return;
          this.consultaEstado = 'erro';
          this.retryTarget = 'orders';
          this.contextError = 'Não foi possível consultar as ordens. Tente novamente.';
          this.feedback = this.contextError;
          this.notification.error(this.contextError);
          this.changeDetector.markForCheck();
        },
      });
  }

  private loadActiveOrder(order: OrdemCentroTrabalho): void {
    const request = ++this.operationRequest;
    this.consultaEstado = 'carregando-ordem';
    this.estado = EstadoOperacao.Carregando;
    this.feedback = `Carregando Ordem ${order.ordem}...`;
    this.contextError = '';
    this.retryTarget = null;

    this.reportOperacaoService.carregarOrdemSelecionada(order)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (request !== this.operationRequest || this.workflowState.snapshot().activeOrder?.id !== order.id) return;
          if (!result.sucesso || !result.operacao) {
            this.consultaEstado = 'erro';
            this.estado = EstadoOperacao.Erro;
            this.workflowState.setOperationState(this.estado);
            this.feedback = result.mensagem ?? 'OP inválida para produção.';
            this.contextError = `${this.feedback} Tente novamente.`;
            this.retryTarget = 'active-order';
            this.notification.warning(this.feedback);
            this.changeDetector.markForCheck();
            return;
          }

          this.operacao = result.operacao;
          this.preencherInicio(result.operacao);
          this.estado = EstadoOperacao.OPEncontrada;
          this.consultaEstado = 'ordens-disponiveis';
          this.contextError = '';
          this.retryTarget = null;
          this.reportes = [];
          this.responsaveis = [];
          this.workflowState.setActiveOperation(this.operacao, this.estado);
          this.workflowState.setScrap([], '');
          this.workflowState.setResponsavel(null);
          if (this.responsavelDefinidoPelaApi) {
            this.applyApiResponsavel(this.operacao);
          } else {
            this.loadResponsaveis();
          }
          this.feedback = `Ordem ${order.ordem} carregada. Inicie a operação.`;
          this.notification.success('OP carregada.');
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (request !== this.operationRequest) return;
          this.consultaEstado = 'erro';
          this.estado = EstadoOperacao.Erro;
          this.workflowState.setOperationState(this.estado);
          this.feedback = 'Não foi possível carregar a ordem. A fila foi preservada para nova tentativa.';
          this.contextError = this.feedback;
          this.retryTarget = 'active-order';
          this.notification.error(this.feedback);
          this.changeDetector.markForCheck();
        },
      });
  }

  private startOperation(): void {
    const responsavel = this.responsavelSelecionado;
    if (!this.operacao || !responsavel) {
      this.feedback = 'Selecione uma equipe ou um operador antes de iniciar.';
      this.notification.warning(this.feedback);
      return;
    }
    const dataInicio = this.normalizarDataInicio(this.dataInicioSelecionada);
    const horaInicio = this.horaInicioSelecionada.trim();
    if (!dataInicio || !this.horaInicioValida(horaInicio)) {
      this.feedback = 'Informe uma data e uma hora de início válidas.';
      this.notification.warning(this.feedback);
      return;
    }
    const operation = this.operacao;
    const activeOrderId = this.workflowState.snapshot().activeOrder?.id;
    const request = ++this.startRequest;
    const operador = responsavel.tipo === 'OPERADOR' ? responsavel.nome : '';
    const equipe = responsavel.tipo === 'EQUIPE' ? responsavel.nome : '';
    this.estado = EstadoOperacao.Carregando;
    this.workflowState.setResponsavel(responsavel);

    this.reportOperacaoService.iniciarOperacao({
      idempotencyKey: this.startIdempotencyKey ||= this.idempotency.resolve(),
      ordem: operation.ordem,
      op: operation.op,
      split: operation.split,
      areaCode: this.workflowState.snapshot().area?.code ?? '',
      workCenterCode: this.workflowState.snapshot().workCenter?.code ?? operation.ct,
      area: this.workflowState.snapshot().area!,
      workCenter: this.workflowState.snapshot().workCenter!,
      operationSnapshot: operation,
      operador,
      equipe,
      tipoResponsavel: responsavel.tipo,
      codigoResponsavel: responsavel.codigo,
      dataInicio,
      horaInicio,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: start => {
        if (
          request !== this.startRequest
          || this.operacao?.op !== operation.op
          || this.workflowState.snapshot().activeOrder?.id !== activeOrderId
        ) return;
        this.operacao = {
          ...operation,
          operador,
          equipe,
          dataInicio: start.dataInicio,
          horaInicio: start.horaInicio,
          ...(start.idempotencyKey ? { startCommandId: start.idempotencyKey } : {}),
          dataFim: undefined,
          horaFim: '',
        };
        this.dataInicioSelecionada = start.dataInicio;
        this.horaInicioSelecionada = start.horaInicio;
        this.estado = EstadoOperacao.OperacaoIniciada;
        this.workflowState.setActiveOperation(this.operacao, this.estado);
        this.feedback = this.auxiliaryFlow === 'refugo'
          ? 'Operação iniciada. Informe a quantidade de refugo no reporte.'
          : 'Operação iniciada. Informe as quantidades para reportar.';
        this.notification.success('Salvo neste dispositivo — envio pendente.');
        if (this.auxiliaryFlow === 'refugo') {
          this.abrirRefugo();
        }
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (
          request !== this.startRequest
          || this.operacao?.op !== operation.op
          || this.workflowState.snapshot().activeOrder?.id !== activeOrderId
        ) return;
        this.estado = EstadoOperacao.Erro;
        this.operacao = operation;
        this.workflowState.setActiveOperation(operation, this.estado);
        this.feedback = 'Não foi possível iniciar a operação. Tente novamente sem perder os dados carregados.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  private reportOperation(draft: ReporteParcialDraft): void {
    const operation = this.operacao;
    const responsavel = this.responsavelSelecionado;
    const refugoItens: NonNullable<ReportarOperacaoRequest['refugoItens']> =
      (draft.refugoItens ?? []).map(item => ({
        ...item,
        quantidade: this.round3(item.quantidade),
      }));
    const quantidadeAprovada = this.round3(draft.quantidadeAprovada);
    const quantidadeRetrabalho = this.round3(draft.quantidadeRetrabalho);
    const quantidadeRefugo = this.round3(draft.quantidadeRefugo);
    const idempotencyKey = draft.idempotencyKey ?? this.idempotency.resolve();
    if (!operation?.dataInicio || !operation.horaInicio || !responsavel || !this.canEditProduction) {
      const message = 'Inicie a operação com uma equipe ou operador válido antes de reportar.';
      this.feedback = message;
      this.notification.warning(message);
      this.reporteSlide?.informarErro(message);
      return;
    }

    const end = this.ensureEnd();
    const ultimoReporte = this.reportes.at(-1);
    if (ultimoReporte && Number.isNaN(ultimoReporte.dataFim.getTime())) {
      const message = 'O histórico possui uma data inválida. Recarregue a operação antes de reportar.';
      this.feedback = message;
      this.notification.error(message);
      this.reporteSlide?.informarErro(message);
      return;
    }
    const intervalStart = {
      dataInicio: ultimoReporte ? new Date(ultimoReporte.dataFim) : new Date(operation.dataInicio),
      horaInicio: ultimoReporte?.horaFim ?? operation.horaInicio,
    };
    const validation = this.reportOperacaoService.validarReporteParcial(
      operation,
      quantidadeAprovada,
      quantidadeRetrabalho,
      quantidadeRefugo,
    );
    const invalidReason = refugoItens.some(item =>
      !Number.isFinite(item.quantidade) || item.quantidade <= 0);
    const requiresReason = quantidadeRefugo > 0 || quantidadeRetrabalho > 0;
    const reasonValidation = invalidReason
      ? 'Os motivos de refugo devem possuir quantidades válidas e maiores que zero.'
      : requiresReason && refugoItens.length !== 1
        ? `Informe exatamente um motivo de refugo ou retrabalho para a Ordem ${operation.ordem}.`
        : !requiresReason && refugoItens.length !== 0
          ? `Remova o motivo da Ordem ${operation.ordem}, pois não há refugo ou retrabalho.`
        : '';

    if (validation || reasonValidation) {
      const message = validation || reasonValidation;
      this.feedback = message;
      this.notification.warning(message);
      this.reporteSlide?.informarErro(message);
      return;
    }

    const activeOrderId = this.workflowState.snapshot().activeOrder?.id;
    const request = ++this.reportRequest;
    this.estado = EstadoOperacao.Reportando;
    this.feedback = 'Salvando reporte neste dispositivo...';

    const parcial: ReportOperacao = {
      ...operation,
      ...intervalStart,
      ...end,
      quantidadeAprovada,
      quantidadeRetrabalho,
      quantidadeRefugo,
    };

    this.reportOperacaoService.reportarOperacao(
      this.toReportRequest(
        parcial, responsavel, refugoItens, idempotencyKey, Boolean(draft.finalizarSplit),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (
            request !== this.reportRequest
            || this.operacao?.op !== operation.op
            || this.workflowState.snapshot().activeOrder?.id !== activeOrderId
          ) return;
          const reporte: ReporteParcialOperacao = {
            id: result.apontamentoId,
            idempotencyKey,
            registradoEm: result.reportadoEm,
            ...intervalStart,
            dataFim: end.dataFim ?? result.reportadoEm,
            horaFim: end.horaFim,
            quantidadeAprovada,
            quantidadeRetrabalho,
            quantidadeRefugo,
            refugoItens: refugoItens.map(item => ({ ...item })),
            commandId: result.apontamentoId,
          };
          this.reportes = [...this.reportes, reporte];
          this.operacao = this.withDerivedTotals({
            ...operation,
            ...end,
          }, this.reportes);
          this.estado = EstadoOperacao.OperacaoIniciada;
          this.workflowState.setActiveOperation(this.operacao, this.estado);
          this.workflowState.addReporte(reporte);
          this.reporteSlide?.confirmarReporte(reporte);
          if (draft.finalizarSplit) {
            this.endOperation();
            return;
          }
          this.feedback = 'Salvo neste dispositivo — envio pendente. A operação continua ativa.';
          this.notification.success('Salvo neste dispositivo — envio pendente.');
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (
            request !== this.reportRequest
            || this.operacao?.op !== operation.op
            || this.workflowState.snapshot().activeOrder?.id !== activeOrderId
          ) return;
          this.estado = EstadoOperacao.Erro;
          this.operacao = operation;
          this.workflowState.setActiveOperation(operation, this.estado);
          this.feedback = 'Não foi possível salvar neste dispositivo. O rascunho foi preservado para correção.';
          this.reporteSlide?.informarErro(this.feedback);
          this.notification.error(this.feedback);
          this.changeDetector.markForCheck();
        },
      });
  }

  private endOperation(): void {
    const operation = this.operacao;
    if (this.encerrando || !operation?.dataInicio || !operation.horaInicio || !this.canEditProduction) return;
    const end = this.ensureEnd();
    const activeOrderId = this.workflowState.snapshot().activeOrder?.id;
    const request = ++this.endRequest;
    const dependencyIds = [
      ...(operation.startCommandId ? [operation.startCommandId] : []),
      ...this.reportes.map(report => report.commandId ?? report.idempotencyKey),
    ];
    this.encerrando = true;
    this.estado = EstadoOperacao.Reportando;

    this.reportOperacaoService.encerrarOperacao({
      idempotencyKey: this.endIdempotencyKey ||= this.idempotency.resolve(),
      ordem: operation.ordem,
      op: operation.op,
      split: operation.split,
      dataFim: end.dataFim ?? new Date(),
      horaFim: end.horaFim,
      ...(dependencyIds.length > 0 ? { dependencyIds } : {}),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (
          request !== this.endRequest
          || this.operacao?.op !== operation.op
          || this.workflowState.snapshot().activeOrder?.id !== activeOrderId
        ) return;
        this.encerrando = false;
        const next = this.workflowState.completeActiveOrder();
        this.clearActiveOperation();
        if (next) {
          this.feedback = `Operação encerrada (${result.apontamentoId}). Carregando a próxima ordem.`;
          this.loadActiveOrder(next);
        } else {
          this.workflowState.finishQueue();
          this.feedback = `Operação encerrada (${result.apontamentoId}). Atualizando ordens.`;
          const area = this.areas.find(item => item.code === this.areaCode);
          const center = this.centers.find(item => item.code === this.workCenterCode);
          if (area && center) {
            this.loadOrders(area, center);
          }
        }
        this.notification.success('Salvo neste dispositivo — envio pendente.');
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (
          request !== this.endRequest
          || this.operacao?.op !== operation.op
          || this.workflowState.snapshot().activeOrder?.id !== activeOrderId
        ) return;
        this.encerrando = false;
        this.estado = EstadoOperacao.Erro;
        this.operacao = operation;
        this.workflowState.setActiveOperation(operation, this.estado);
        this.feedback = 'Não foi possível encerrar a operação. Os reportes foram preservados.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  private confirmDiscardIfRequired(action: () => void): void {
    if (!this.workflowState.hasActiveWorkflow()) {
      action();
      return;
    }

    this.dialog.confirm({
      title: 'Descartar apontamento?',
      message: 'Existe um apontamento não concluído. Deseja descartar a fila e os dados informados?',
      confirm: action,
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
    });
  }

  private endFlowAndNavigate(route: string): void {
    this.confirmDiscardIfRequired(() => {
      this.invalidateRequests();
      this.workflowState.clear();
      void this.router.navigate([route]);
    });
  }

  private hydrate(snapshot: ReturnType<ReportOperacaoWorkflowState['snapshot']>): void {
    this.areaCode = snapshot.area?.code ?? '';
    this.workCenterCode = snapshot.workCenter?.code ?? '';
    this.orders = snapshot.orders.map(order => ({ ...order }));
    const selectedOrder = snapshot.activeOrder
      ?? this.orders.find(order => snapshot.selectedOrderIds.has(order.id))
      ?? null;
    this.selectedOrderIds = new Set(selectedOrder ? [selectedOrder.id] : []);
    this.estado = snapshot.operationState === EstadoOperacao.Reportando
      ? (snapshot.operation?.dataInicio ? EstadoOperacao.OperacaoIniciada : EstadoOperacao.OPEncontrada)
      : snapshot.operationState;
    this.reportes = snapshot.reportes.map(reporte => ({
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
      dataInicio: new Date(reporte.dataInicio),
      dataFim: new Date(reporte.dataFim),
      refugoItens: (reporte.refugoItens ?? []).map(item => ({ ...item })),
    }));
    this.operacao = snapshot.operation
      ? this.withDerivedTotals({ ...snapshot.operation }, this.reportes)
      : null;
    this.preencherInicio(this.operacao);
    this.tipoResponsavel = snapshot.responsavel?.tipo ?? 'OPERADOR';
    this.responsavelCodigo = snapshot.responsavel?.codigo ?? '';
    if (snapshot.operation) {
      if (snapshot.operationState === EstadoOperacao.Reportando) {
        this.workflowState.setActiveOperation(this.operacao!, this.estado);
      } else if (
        this.operacao
        && (
          this.operacao.quantidadeAprovada !== snapshot.operation.quantidadeAprovada
          || this.operacao.quantidadeRetrabalho !== snapshot.operation.quantidadeRetrabalho
          || this.operacao.quantidadeRefugo !== snapshot.operation.quantidadeRefugo
        )
      ) {
        this.workflowState.updateOperation(this.operacao);
      }
      this.consultaEstado = 'ordens-disponiveis';
      this.feedback = 'Apontamento restaurado.';
    }
  }

  private clearActiveOperation(): void {
    this.operacao = null;
    this.estado = EstadoOperacao.SemOP;
    this.reportes = [];
    this.responsavelCodigo = '';
    this.tipoResponsavel = 'OPERADOR';
    this.dataInicioSelecionada = null;
    this.horaInicioSelecionada = '';
    this.startIdempotencyKey = '';
    this.endIdempotencyKey = '';
  }

  private invalidateRequests(): void {
    this.centersRequest += 1;
    this.isLoadingCenters = false;
    this.ordersRequest += 1;
    this.operationRequest += 1;
    this.startRequest += 1;
    this.reportRequest += 1;
    this.endRequest += 1;
    this.responsaveisRequest += 1;
    this.loadingResponsaveis = false;
    this.invalidateTeamContext();
  }

  private ensureEnd(): Pick<ReportOperacao, 'dataFim' | 'horaFim'> {
    const now = new Date();
    return {
      dataFim: now,
      horaFim: this.formatTime(now),
    };
  }

  private toReportRequest(
    operation: ReportOperacao,
    responsavel: ResponsavelOperacao,
    refugoItens: ReportarOperacaoRequest['refugoItens'],
    idempotencyKey: string,
    finalizarSplit: boolean,
  ): ReportarOperacaoRequest {
    const dependencyIds = [
      ...(operation.startCommandId ? [operation.startCommandId] : []),
      ...this.reportes.map(report => report.commandId ?? report.idempotencyKey),
    ];
    return {
      idempotencyKey,
      ordem: operation.ordem,
      op: operation.op,
      split: operation.split,
      areaCode: this.areaCode,
      finalizarSplit,
      quantidadeAprovada: operation.quantidadeAprovada,
      quantidadeRetrabalho: operation.quantidadeRetrabalho,
      quantidadeRefugo: operation.quantidadeRefugo,
      refugoItens: refugoItens?.map(item => ({ ...item })),
      dataInicio: operation.dataInicio!,
      horaInicio: operation.horaInicio,
      dataFim: operation.dataFim ?? new Date(),
      horaFim: operation.horaFim,
      operador: operation.operador,
      equipe: operation.equipe,
      tipoResponsavel: responsavel.tipo,
      codigoResponsavel: responsavel.codigo,
      ct: operation.ct,
      ...(dependencyIds.length > 0 ? { dependencyIds } : {}),
    };
  }

  private formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  private preencherInicio(operation: ReportOperacao | null): void {
    if (operation?.dataInicio) {
      this.dataInicioSelecionada = operation.dataInicio;
      this.horaInicioSelecionada = operation.horaInicio;
      return;
    }
    const now = new Date();
    this.dataInicioSelecionada = now;
    this.horaInicioSelecionada = this.formatTime(now);
  }

  private normalizarDataInicio(value: Date | string | null): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : new Date(value);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1])
      && date.getMonth() === Number(match[2]) - 1
      && date.getDate() === Number(match[3])
      ? date
      : null;
  }

  private horaInicioValida(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
  }

  private round3(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private formatQuantity(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value);
  }

  private withDerivedTotals(
    operation: ReportOperacao,
    reportes: ReadonlyArray<ReporteParcialOperacao>,
  ): ReportOperacao {
    return {
      ...operation,
      quantidadeAprovada: this.round3(
        reportes.reduce((total, reporte) => total + reporte.quantidadeAprovada, 0),
      ),
      quantidadeRetrabalho: this.round3(
        reportes.reduce((total, reporte) => total + reporte.quantidadeRetrabalho, 0),
      ),
      quantidadeRefugo: this.round3(
        reportes.reduce((total, reporte) => total + reporte.quantidadeRefugo, 0),
      ),
    };
  }

  private loadResponsaveis(): void {
    if (this.operacao && this.responsavelDefinidoPelaApi) {
      this.applyApiResponsavel(this.operacao);
      return;
    }
    const request = ++this.responsaveisRequest;
    const areaCode = this.normalizeCode(this.areaCode);
    const workCenterCode = this.normalizeCode(this.workCenterCode);
    this.loadingResponsaveis = true;
    this.responsaveisError = '';
    this.reportOperacaoService.listarResponsaveis(this.areaCode, this.workCenterCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: responsaveis => {
          if (
            request !== this.responsaveisRequest
            || areaCode !== this.normalizeCode(this.areaCode)
            || workCenterCode !== this.normalizeCode(this.workCenterCode)
          ) return;
          this.loadingResponsaveis = false;
          const frozenResponsavel = this.operacao?.dataInicio
            ? this.workflowState.snapshot().responsavel
            : null;
          this.responsaveis = responsaveis.map(responsavel => ({ ...responsavel }));
          if (
            frozenResponsavel
            && !this.responsaveis.some(item =>
              item.tipo === frozenResponsavel.tipo && item.codigo === frozenResponsavel.codigo)
          ) {
            this.responsaveis = [{ ...frozenResponsavel }, ...this.responsaveis];
          }
          if (this.responsavelCodigo && !this.responsavelSelecionado && !this.operacao?.dataInicio) {
            this.responsavelCodigo = '';
            this.workflowState.setResponsavel(null);
          }
          if (responsaveis.length === 0) {
            this.responsaveisError = frozenResponsavel
              ? 'Responsável iniciado preservado; não foi possível revalidar a elegibilidade.'
              : 'Nenhuma equipe ou operador elegível. Tente novamente.';
            this.feedback = this.responsaveisError;
          }
          if (this.operacao && !this.responsavelCodigo) {
            this.selectInitialResponsavel(this.operacao);
          }
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (
            request !== this.responsaveisRequest
            || areaCode !== this.normalizeCode(this.areaCode)
            || workCenterCode !== this.normalizeCode(this.workCenterCode)
          ) return;
          this.loadingResponsaveis = false;
          const frozenResponsavel = this.operacao?.dataInicio
            ? this.workflowState.snapshot().responsavel
            : null;
          if (
            frozenResponsavel
            && !this.responsaveis.some(item =>
              item.tipo === frozenResponsavel.tipo && item.codigo === frozenResponsavel.codigo)
          ) {
            this.responsaveis = [{ ...frozenResponsavel }, ...this.responsaveis];
          }
          this.responsaveisError = frozenResponsavel
            ? 'Responsável iniciado preservado; não foi possível revalidar a elegibilidade.'
            : 'Não foi possível carregar equipes e operadores. Tente novamente.';
          this.feedback = this.responsaveisError;
          this.notification.error(this.feedback);
          this.changeDetector.markForCheck();
        },
      });
  }

  private selectInitialResponsavel(operacao: ReportOperacao): void {
    const snapshotResponsavel = this.workflowState.snapshot().responsavel;
    const contextoOperador = this.operationalContext.currentContext?.operator;
    const responsavel =
      snapshotResponsavel
      ?? this.responsaveis.find(item =>
        item.tipo === 'OPERADOR'
        && (item.codigo === contextoOperador?.code || item.nome === contextoOperador?.name),
      )
      ?? this.responsaveis.find(item => item.tipo === 'OPERADOR' && item.nome === operacao.operador)
      ?? this.responsaveis.find(item => item.tipo === 'EQUIPE' && item.nome === operacao.equipe)
      ?? null;

    this.tipoResponsavel = responsavel?.tipo ?? 'OPERADOR';
    this.responsavelCodigo = responsavel?.codigo ?? '';
    this.workflowState.setResponsavel(responsavel);
  }

  private applyApiResponsavel(operacao: ReportOperacao): void {
    const tipo: TipoResponsavelOperacao = operacao.indReporteMod === 3 ? 'EQUIPE' : 'OPERADOR';
    const codigo = this.normalizeCode(operacao.responsavelCodigo ?? '');
    this.tipoResponsavel = tipo;
    this.responsavelCodigo = codigo;
    this.loadingResponsaveis = false;
    this.responsaveis = [];
    this.responsaveisError = '';

    if (!codigo) {
      this.responsaveisError = `A API não informou ${tipo === 'OPERADOR' ? 'o operador' : 'a equipe'} definido para esta ordem.`;
      this.feedback = this.responsaveisError;
      this.workflowState.setResponsavel(null);
      return;
    }

    const responsavel: ResponsavelOperacao = {
      tipo,
      codigo,
      nome: operacao.responsavelNome?.trim() || codigo,
    };
    this.responsaveis = [responsavel];
    this.workflowState.setResponsavel(responsavel);
  }

  private invalidateTeamContext(): void {
    this.teamGeneration += 1;
    this.activeTeamContext = null;
  }

  private responsavelKey(responsavel: ResponsavelOperacao): string {
    return `${responsavel.tipo}|${this.normalizeCode(responsavel.codigo)}`;
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }
}
