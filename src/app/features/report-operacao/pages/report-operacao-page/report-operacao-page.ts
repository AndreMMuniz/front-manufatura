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

import {
  PoDialogService,
  PoLoadingModule,
  PoNotificationService,
  PoPageModule,
} from '@po-ui/ng-components';

import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { WorkCenter } from '../../../shop-floor/models/work-center';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { ContextoProducaoCard } from '../../components/contexto-producao-card/contexto-producao-card';
import { OpDetalhesCard } from '../../components/op-detalhes-card/op-detalhes-card';
import { OperacaoInfoCard } from '../../components/operacao-info-card/operacao-info-card';
import { OrdensCentroList } from '../../components/ordens-centro-list/ordens-centro-list';
import { ProducaoForm } from '../../components/producao-form/producao-form';
import { RefugoRegistrado, RefugoRegistradoItem, RefugoSlide } from '../../components/refugo-slide/refugo-slide';
import { ReporteParcialDraft, ReporteSlide } from '../../components/reporte-slide/reporte-slide';
import { ReportActions } from '../../components/report-actions/report-actions';
import { ReportarOperacaoRequest } from '../../interfaces/report-operacao.dto';
import {
  AreaProducao,
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
    ContextoProducaoCard,
    OpDetalhesCard,
    OperacaoInfoCard,
    OrdensCentroList,
    ProducaoForm,
    RefugoSlide,
    ReporteSlide,
    ReportActions,
    PoLoadingModule,
    PoPageModule,
  ],
  templateUrl: './report-operacao-page.html',
  styleUrls: ['./report-operacao-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportOperacaoPage implements OnInit {
  @ViewChild(RefugoSlide) private refugoSlide?: RefugoSlide;
  @ViewChild(ReporteSlide) private reporteSlide?: ReporteSlide;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reportOperacaoService = inject(ReportOperacaoService);
  private readonly workflowState = inject(ReportOperacaoWorkflowState);
  private readonly operationalContext = inject(OperationalContextService);
  private readonly reporteParadasService = inject(ReporteParadasService);
  private readonly notification = inject(PoNotificationService);
  private readonly dialog = inject(PoDialogService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auxiliaryFlow = this.route.snapshot.data['auxiliaryFlow'];

  readonly pageTitle = this.auxiliaryFlow === 'refugo' ? 'Refugo / Retrabalho' : 'Reporta Operação';

  areas: ReadonlyArray<AreaProducao> = [];
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
  ultimoMotivoRefugo = '';
  refugoItens: ReadonlyArray<RefugoRegistradoItem> = [];
  responsaveis: ReadonlyArray<ResponsavelOperacao> = [];
  tipoResponsavel: TipoResponsavelOperacao = 'OPERADOR';
  responsavelCodigo = '';
  reportes: ReadonlyArray<ReporteParcialOperacao> = [];
  encerrando = false;

  private areasRequest = 0;
  private centersRequest = 0;
  private ordersRequest = 0;
  private operationRequest = 0;
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
    return this.responsaveis.find(
      responsavel => responsavel.tipo === this.tipoResponsavel && responsavel.codigo === this.responsavelCodigo,
    ) ?? null;
  }

  get iniciarDisabled(): boolean {
    const podeIniciar =
      this.estado === EstadoOperacao.OPEncontrada
      || (this.estado === EstadoOperacao.Erro && !this.operacao?.dataInicio);
    return this.isBusy || !this.operacao || !this.responsavelSelecionado || !podeIniciar;
  }

  get reporteDisabled(): boolean {
    return this.isBusy || !this.canEditProduction;
  }

  get encerrarDisabled(): boolean {
    return this.isBusy || !this.canEditProduction;
  }

  ngOnInit(): void {
    const snapshot = this.workflowState.snapshot();
    this.hydrate(snapshot);
    this.loadAreas();
    this.loadResponsaveis();
  }

  onAreaChange(code: string): void {
    const apply = () => this.applyAreaChange(code);
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

    if (this.retryTarget === 'areas') {
      this.loadAreas();
      return;
    }

    if (this.areaCode && this.workCenterCode) {
      this.consultOrders();
      return;
    }

    this.loadAreas();
  }

  updateSelection(ids: ReadonlySet<string>): void {
    this.selectedOrderIds = new Set(ids);
    this.workflowState.setOrders(this.orders);
    this.workflowState.setSelectedOrderIds(this.selectedOrderIds);
  }

  openSelectedOrders(): void {
    if (this.selectedOrderIds.size === 0) {
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
    this.startOperation();
  }

  abrirReporte(): void {
    if (!this.reporteDisabled) {
      this.reporteSlide?.abrir(this.reportes);
    }
  }

  alterarTipoResponsavel(tipo: TipoResponsavelOperacao): void {
    if (this.operacao?.dataInicio || this.isBusy) {
      return;
    }

    this.tipoResponsavel = tipo;
    this.responsavelCodigo = '';
    this.workflowState.setResponsavel(null);
  }

  alterarResponsavel(codigo: string): void {
    if (this.operacao?.dataInicio || this.isBusy) {
      return;
    }

    this.responsavelCodigo = codigo ?? '';
    this.workflowState.setResponsavel(this.responsavelSelecionado);
  }

  salvarReporte(draft: ReporteParcialDraft): void {
    this.reportOperation(draft);
  }

  solicitarEncerramento(): void {
    if (this.encerrarDisabled) {
      return;
    }

    this.dialog.confirm({
      title: 'Encerrar operação?',
      message: 'A operação será concluída sem criar um novo reporte. Deseja continuar?',
      confirm: () => this.endOperation(),
      literals: { cancel: 'Cancelar', confirm: 'Encerrar' },
    });
  }

  abrirRefugo(): void {
    if (this.operacao && this.canOpenAuxiliaryFlows) {
      this.refugoSlide?.abrir(this.operacao.quantidadeRefugo, this.refugoItens);
    }
  }

  registrarRefugo(refugo: RefugoRegistrado): void {
    if (!this.operacao) {
      return;
    }

    const previous = this.operacao;
    this.operacao = { ...this.operacao, quantidadeRefugo: refugo.quantidade };
    const validation = this.reportOperacaoService.validarReporte(this.operacao);

    if (validation) {
      this.operacao = previous;
      this.feedback = validation;
      this.notification.warning(validation);
      this.changeDetector.markForCheck();
      return;
    }

    this.refugoItens = refugo.itens.map(item => ({ ...item }));
    this.ultimoMotivoRefugo = refugo.motivo;
    this.workflowState.updateOperation(this.operacao);
    this.workflowState.setScrap(this.refugoItens, this.ultimoMotivoRefugo);
    this.feedback = 'Refugo registrado no painel lateral.';
    this.notification.success('Refugo registrado.');
    this.changeDetector.markForCheck();
  }

  abrirRetrabalho(): void {
    this.feedback = 'Fluxo de retrabalho preparado para implementação futura.';
    this.notification.information(this.feedback);
  }

  abrirParada(): void {
    if (!this.operacao || !this.canOpenAuxiliaryFlows) {
      return;
    }

    this.workflowState.setActiveOperation(this.operacao, this.estado);
    this.workflowState.setScrap(this.refugoItens, this.ultimoMotivoRefugo);
    this.feedback = 'Abrindo reporte de paradas com o contexto da operação.';
    this.reporteParadasService.setContextFromOperation(this.operacao);
    void this.router.navigate(['/stoppages']);
  }

  voltar(): void {
    this.endFlowAndNavigate('/work-center');
  }

  sair(): void {
    this.endFlowAndNavigate('/quality-control');
  }

  private loadAreas(): void {
    const request = ++this.areasRequest;
    this.consultaEstado = 'carregando-areas';
    this.contextError = '';
    this.retryTarget = null;

    this.reportOperacaoService.listarAreasProducao()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: areas => {
          if (request !== this.areasRequest) return;
          this.areas = areas.map(area => ({ ...area }));
          this.consultaEstado = this.orders.length
            ? 'ordens-disponiveis'
            : this.areaCode ? 'pronto' : 'contexto-pendente';
          this.applyInitialContext();
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (request !== this.areasRequest) return;
          this.consultaEstado = 'erro';
          this.retryTarget = 'areas';
          this.contextError = 'Não foi possível carregar as Áreas de Produção.';
          this.feedback = this.contextError;
          this.notification.error(this.contextError);
          this.changeDetector.markForCheck();
        },
      });
  }

  private applyInitialContext(): void {
    const snapshot = this.workflowState.snapshot();
    const contextCenter = snapshot.workCenter ?? this.operationalContext.currentContext?.workCenter ?? null;
    const areaCode = snapshot.area?.code ?? contextCenter?.areaCode ?? '';
    const area = this.areas.find(item => item.code === areaCode);

    if (!area || !contextCenter) {
      return;
    }

    this.areaCode = area.code;
    this.loadCenters(area.code, contextCenter.code, true);
  }

  private applyAreaChange(code: string): void {
    const area = this.areas.find(item => item.code === code) ?? null;
    this.invalidateRequests();
    this.areaCode = area?.code ?? '';
    this.workCenterCode = '';
    this.centers = [];
    this.orders = [];
    this.selectedOrderIds = new Set<string>();
    this.clearActiveOperation();
    this.contextError = '';
    this.consultaEstado = area ? 'pronto' : 'contexto-pendente';
    this.workflowState.setContext(area, null);

    if (area) {
      this.feedback = 'Selecione o Centro de Trabalho.';
      this.loadCenters(area.code);
    } else {
      this.feedback = 'Selecione a Área de Produção e o Centro de Trabalho para consultar as ordens.';
    }

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
          const prefill = this.centers.find(center => center.code === prefillCode) ?? null;
          if (prefill) {
            this.workCenterCode = prefill.code;
            const area = this.areas.find(item => item.code === areaCode) ?? null;
            this.workflowState.setContext(area, prefill);
            this.feedback = this.workflowState.hasActiveWorkflow()
              ? 'Apontamento restaurado.'
              : 'Centro de Trabalho preenchido. Consulte as ordens liberadas.';
          } else if (prefillCode) {
            this.retryTarget = 'centers';
            this.contextError = 'O Centro de Trabalho restaurado não está mais ativo ou disponível.';
            this.feedback = this.contextError;
            if (!preserveWorkflow) {
              this.workCenterCode = '';
              const area = this.areas.find(item => item.code === areaCode) ?? null;
              this.workflowState.setContext(area, null);
            }
          }
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (request !== this.centersRequest) return;
          this.isLoadingCenters = false;
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
          this.estado = EstadoOperacao.OPEncontrada;
          this.consultaEstado = 'ordens-disponiveis';
          this.contextError = '';
          this.retryTarget = null;
          this.refugoItens = [];
          this.ultimoMotivoRefugo = '';
          this.reportes = [];
          this.workflowState.setActiveOperation(this.operacao, this.estado);
          this.workflowState.setScrap([], '');
          this.selectInitialResponsavel(this.operacao);
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
    const now = new Date();
    const horaInicio = this.formatTime(now);
    this.operacao = {
      ...this.operacao,
      operador: responsavel.tipo === 'OPERADOR' ? responsavel.nome : '',
      equipe: responsavel.tipo === 'EQUIPE' ? responsavel.nome : '',
    };
    this.estado = EstadoOperacao.Carregando;
    this.workflowState.setResponsavel(responsavel);
    this.workflowState.setOperationState(this.estado);

    this.reportOperacaoService.iniciarOperacao({
      ordem: this.operacao.ordem,
      op: this.operacao.op,
      split: this.operacao.split,
      operador: this.operacao.operador,
      equipe: this.operacao.equipe,
      dataInicio: now,
      horaInicio,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: start => {
        if (!this.operacao) return;
        this.operacao = {
          ...this.operacao,
          dataInicio: start.dataInicio,
          horaInicio: start.horaInicio,
          dataFim: undefined,
          horaFim: '',
        };
        this.estado = EstadoOperacao.OperacaoIniciada;
        this.workflowState.setActiveOperation(this.operacao, this.estado);
        this.feedback = this.auxiliaryFlow === 'refugo'
          ? 'Operação iniciada. Registre os motivos e quantidades de refugo.'
          : 'Operação iniciada. Informe as quantidades para reportar.';
        this.notification.success('Operação iniciada.');
        if (this.auxiliaryFlow === 'refugo') {
          this.abrirRefugo();
        }
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.estado = EstadoOperacao.Erro;
        this.workflowState.setOperationState(this.estado);
        this.feedback = 'Não foi possível iniciar a operação. Tente novamente sem perder os dados carregados.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  private reportOperation(draft: ReporteParcialDraft): void {
    if (!this.operacao) return;
    const end = this.ensureEnd();
    const validation = this.reportOperacaoService.validarReporteParcial(
      this.operacao,
      draft.quantidadeAprovada,
      draft.quantidadeRetrabalho,
      draft.quantidadeRefugo,
    );

    if (validation) {
      this.feedback = validation;
      this.notification.warning(validation);
      this.reporteSlide?.informarErro(validation);
      return;
    }

    this.estado = EstadoOperacao.Reportando;
    this.workflowState.setOperationState(this.estado);
    this.feedback = 'Enviando reporte parcial ao Datasul...';

    const parcial: ReportOperacao = {
      ...this.operacao,
      ...end,
      quantidadeAprovada: draft.quantidadeAprovada,
      quantidadeRetrabalho: draft.quantidadeRetrabalho,
      quantidadeRefugo: draft.quantidadeRefugo,
    };

    this.reportOperacaoService.reportarOperacao(this.toReportRequest(parcial))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (!this.operacao) return;
          const reporte: ReporteParcialOperacao = {
            id: result.apontamentoId,
            registradoEm: result.reportadoEm,
            ...draft,
          };
          this.reportes = [...this.reportes, reporte];
          this.operacao = {
            ...this.operacao,
            ...end,
            quantidadeAprovada: this.operacao.quantidadeAprovada + draft.quantidadeAprovada,
            quantidadeRetrabalho: this.operacao.quantidadeRetrabalho + draft.quantidadeRetrabalho,
            quantidadeRefugo: this.operacao.quantidadeRefugo + draft.quantidadeRefugo,
          };
          this.estado = EstadoOperacao.OperacaoIniciada;
          this.workflowState.setActiveOperation(this.operacao, this.estado);
          this.workflowState.addReporte(reporte);
          this.reporteSlide?.confirmarReporte(reporte);
          this.feedback = `Reporte ${result.apontamentoId} registrado. A operação continua ativa.`;
          this.notification.success('Reporte registrado com sucesso.');
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.estado = EstadoOperacao.Erro;
          this.workflowState.setActiveOperation(this.operacao!, this.estado);
          this.feedback = 'Não foi possível comunicar com o ERP. O reporte foi preservado para nova tentativa.';
          this.reporteSlide?.informarErro(this.feedback);
          this.notification.error(this.feedback);
          this.changeDetector.markForCheck();
        },
      });
  }

  private endOperation(): void {
    if (!this.operacao) return;
    const end = this.ensureEnd();
    this.encerrando = true;
    this.estado = EstadoOperacao.Reportando;
    this.workflowState.setOperationState(this.estado);

    this.reportOperacaoService.encerrarOperacao({
      ordem: this.operacao.ordem,
      op: this.operacao.op,
      split: this.operacao.split,
      dataFim: end.dataFim ?? new Date(),
      horaFim: end.horaFim,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
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
        this.notification.success('Operação encerrada.');
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.encerrando = false;
        this.estado = EstadoOperacao.Erro;
        this.workflowState.setActiveOperation({ ...this.operacao!, ...end }, this.estado);
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
    this.selectedOrderIds = new Set(snapshot.selectedOrderIds);
    this.operacao = snapshot.operation ? { ...snapshot.operation } : null;
    this.estado = snapshot.operationState;
    this.refugoItens = snapshot.scrapItems.map(item => ({ ...item }));
    this.ultimoMotivoRefugo = snapshot.lastScrapReason;
    this.reportes = snapshot.reportes.map(reporte => ({
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
    }));
    this.tipoResponsavel = snapshot.responsavel?.tipo ?? 'OPERADOR';
    this.responsavelCodigo = snapshot.responsavel?.codigo ?? '';
    if (snapshot.operation) {
      this.consultaEstado = 'ordens-disponiveis';
      this.feedback = 'Apontamento restaurado.';
    }
  }

  private clearActiveOperation(): void {
    this.operacao = null;
    this.estado = EstadoOperacao.SemOP;
    this.refugoItens = [];
    this.ultimoMotivoRefugo = '';
    this.reportes = [];
    this.responsavelCodigo = '';
    this.tipoResponsavel = 'OPERADOR';
  }

  private invalidateRequests(): void {
    this.centersRequest += 1;
    this.isLoadingCenters = false;
    this.ordersRequest += 1;
    this.operationRequest += 1;
  }

  private ensureEnd(): Pick<ReportOperacao, 'dataFim' | 'horaFim'> {
    const now = new Date();
    return {
      dataFim: now,
      horaFim: this.formatTime(now),
    };
  }

  private toReportRequest(operation: ReportOperacao): ReportarOperacaoRequest {
    return {
      ordem: operation.ordem,
      op: operation.op,
      split: operation.split,
      quantidadeAprovada: operation.quantidadeAprovada,
      quantidadeRetrabalho: operation.quantidadeRetrabalho,
      quantidadeRefugo: operation.quantidadeRefugo,
      refugoItens: this.refugoItens.map(item => ({ ...item })),
      dataInicio: operation.dataInicio ?? new Date(),
      horaInicio: operation.horaInicio,
      dataFim: operation.dataFim ?? new Date(),
      horaFim: operation.horaFim,
      operador: operation.operador,
      equipe: operation.equipe,
      ct: operation.ct,
    };
  }

  private formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  private loadResponsaveis(): void {
    this.reportOperacaoService.listarResponsaveis()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: responsaveis => {
          this.responsaveis = responsaveis.map(responsavel => ({ ...responsavel }));
          if (this.operacao && !this.responsavelCodigo) {
            this.selectInitialResponsavel(this.operacao);
          }
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.feedback = 'Não foi possível carregar equipes e operadores.';
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
}
