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
import { Router } from '@angular/router';

import {
  PoButtonModule,
  PoDialogService,
  PoNotificationService,
  PoPageModule,
} from '@po-ui/ng-components';

import { AuthSessionService } from '../../../../core/auth/auth-session.service';
import {
  GerenciarEquipeResultado,
  GerenciarEquipeSlide,
} from '../../../equipes/components/gerenciar-equipe-slide/gerenciar-equipe-slide';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { ContextoProducaoSelector } from '../../../shop-floor/components/contexto-producao-selector/contexto-producao-selector';
import { AreaProducao } from '../../../shop-floor/models/production-area';
import { WorkCenter } from '../../../shop-floor/models/work-center';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { FooterAcoesBatelada } from '../../components/footer-acoes-batelada/footer-acoes-batelada';
import { InformacoesBatelada } from '../../components/informacoes-batelada/informacoes-batelada';
import { OrdensCentroBateladaList } from '../../components/ordens-centro-list/ordens-centro-list';
import { OrdensSelecionadasBatelada } from '../../components/ordens-selecionadas/ordens-selecionadas';
import { ReporteBateladaSlide } from '../../components/reporte-batelada-slide/reporte-batelada-slide';
import {
  EstadoBatelada,
  RascunhoReporteBatelada,
  ResponsavelBatelada,
  TotaisBatelada,
  TotaisOrdemBatelada,
} from '../../models/reporta-batelada.model';
import { ReportaBateladaService } from '../../services/reporta-batelada.service';
import {
  ReportaBateladaWorkflowSnapshot,
  ReportaBateladaWorkflowState,
} from '../../services/reporta-batelada-workflow-state';

@Component({
  selector: 'app-reporta-batelada-page',
  imports: [
    ContextoProducaoSelector,
    FooterAcoesBatelada,
    InformacoesBatelada,
    OrdensCentroBateladaList,
    OrdensSelecionadasBatelada,
    ReporteBateladaSlide,
    GerenciarEquipeSlide,
    PoButtonModule,
    PoPageModule,
  ],
  providers: [ReportaBateladaWorkflowState],
  templateUrl: './reporta-batelada-page.html',
  styleUrls: ['./reporta-batelada-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportaBateladaPage implements OnInit {
  @ViewChild(ReporteBateladaSlide) private reportSlide!: ReporteBateladaSlide;
  @ViewChild(GerenciarEquipeSlide) private gerenciarEquipeSlide?: GerenciarEquipeSlide;

  private readonly router = inject(Router);
  private readonly operationalContext = inject(OperationalContextService);
  private readonly stoppages = inject(ReporteParadasService);
  private readonly service = inject(ReportaBateladaService);
  private readonly workflow = inject(ReportaBateladaWorkflowState);
  private readonly notification = inject(PoNotificationService);
  private readonly dialog = inject(PoDialogService);
  private readonly authSession = inject(AuthSessionService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  areas: ReadonlyArray<AreaProducao> = [];
  centers: ReadonlyArray<WorkCenter> = [];
  view: ReportaBateladaWorkflowSnapshot = this.workflow.snapshot();
  selectedIds: ReadonlySet<string> = new Set<string>();
  loadingAreas = false;
  loadingCenters = false;
  loadingResponsaveis = false;
  responsaveisErrorMessage = '';

  private centersRequest = 0;
  private ordersRequest = 0;
  private preferredOperatorCode = '';
  private responsaveisRetry: {
    readonly request: number;
    readonly areaCode: string;
    readonly workCenterCode: string;
  } | null = null;
  private historyRequest = 0;
  private reportRequest = 0;
  private endingRequest = 0;
  private startRequest = 0;
  private responsaveisRequest = 0;
  private sessionActive = true;
  private teamGeneration = 0;
  private activeTeamContext: {
    readonly generation: number;
    readonly areaCode: string;
    readonly workCenterCode: string;
  } | null = null;

  get canStart(): boolean {
    return this.workflow.canStart();
  }

  get started(): boolean {
    return [
      EstadoBatelada.BateladaIniciada,
      EstadoBatelada.Iniciando,
      EstadoBatelada.ReportandoParcial,
      EstadoBatelada.EmParada,
      EstadoBatelada.Encerrando,
    ].includes(this.view.estado);
  }

  get canReport(): boolean {
    return this.workflow.canReport();
  }

  get canEnd(): boolean {
    return this.workflow.canEnd();
  }

  get contextLocked(): boolean {
    return [
      EstadoBatelada.Iniciando,
      EstadoBatelada.BateladaIniciada,
      EstadoBatelada.ReportandoParcial,
      EstadoBatelada.EmParada,
      EstadoBatelada.Encerrando,
      EstadoBatelada.Encerrada,
    ].includes(this.view.estado);
  }

  get workflowTotals(): ReadonlyArray<TotaisOrdemBatelada> {
    return this.workflow.totalsByOrder();
  }

  get workflowBatchTotals(): TotaisBatelada {
    return this.workflow.batchTotals();
  }

  get canManageTeam(): boolean {
    const area = this.view.area;
    const center = this.view.workCenter;
    return this.sessionActive
      && Boolean(area)
      && Boolean(
        center
        && center.active
        && this.normalizeCode(center.areaCode) === this.normalizeCode(area?.code ?? ''),
      )
      && this.view.composition.length > 0
      && !this.contextLocked
      && !this.loadingAreas
      && !this.loadingCenters
      && !this.loadingResponsaveis
      && this.gerenciarEquipeSlide?.state() !== 'saving';
  }

  ngOnInit(): void {
    this.authSession.session$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(session => {
        this.sessionActive = session !== null;
        if (session === null) {
          this.invalidateTeamContext();
          this.centersRequest += 1;
          this.ordersRequest += 1;
          this.responsaveisRequest += 1;
          this.historyRequest += 1;
          this.reportRequest += 1;
          this.endingRequest += 1;
          this.startRequest += 1;
          this.responsaveisRetry = null;
          this.areas = [];
          this.centers = [];
          this.loadingAreas = false;
          this.loadingCenters = false;
          this.loadingResponsaveis = false;
          this.syncView();
        }
      });
    this.destroyRef.onDestroy(() => this.invalidateTeamContext());

    const stopped = this.service.retomarFluxoParada();
    if (stopped && this.workflow.restoreAfterStop(stopped)) {
      this.areas = stopped.area ? [{ ...stopped.area }] : [];
      this.centers = stopped.workCenter ? [{ ...stopped.workCenter }] : [];
      this.syncView();
      return;
    }

    const context = this.operationalContext.currentContext;
    const batchContext = context?.reportType === 'BATCH' ? context : null;
    this.preferredOperatorCode = batchContext?.operator.code ?? '';
    this.loadingAreas = true;

    this.service.listarAreas()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: areas => {
        if (!this.sessionActive) {
          return;
        }
        this.areas = areas.map(area => ({ ...area }));
        this.loadingAreas = false;

        if (batchContext) {
          const area =
            this.areas.find(item => item.code === batchContext.workCenter.areaCode) ??
            {
              code: batchContext.workCenter.areaCode,
              description: batchContext.workCenter.area,
            };
          this.workflow.setArea(area);
          this.syncView();
          this.carregarCentros(area.code, batchContext.workCenter.code);
        } else {
          this.syncView();
        }
      },
      error: () => {
        if (!this.sessionActive) {
          return;
        }
        this.loadingAreas = false;
        this.notification.error('Não foi possível carregar as Áreas de Produção.');
        this.syncView();
      },
      });
  }

  selecionarArea(code: string): void {
    const area = this.areas.find(item => item.code === code) ?? null;
    if (!this.workflow.setArea(area)) {
      this.syncView();
      return;
    }

    this.invalidateTeamContext();
    this.ordersRequest += 1;
    this.centersRequest += 1;
    this.centers = [];
    this.loadingCenters = false;
    this.responsaveisErrorMessage = '';
    this.responsaveisRetry = null;
    this.responsaveisRequest += 1;
    this.loadingResponsaveis = false;
    this.syncView();

    if (area) {
      this.carregarCentros(area.code);
    }
  }

  selecionarCentro(code: string): void {
    const center = this.centers.find(item => item.code === code) ?? null;
    if (!this.workflow.setWorkCenter(center)) {
      this.syncView();
      return;
    }
    this.invalidateTeamContext();
    this.ordersRequest += 1;
    this.responsaveisErrorMessage = '';
    this.responsaveisRetry = null;
    this.responsaveisRequest += 1;
    this.loadingResponsaveis = false;
    this.syncView();
  }

  consultarOrdens(): void {
    const snapshot = this.workflow.snapshot();
    if (!snapshot.area || !snapshot.workCenter || !this.workflow.startOrdersQuery()) {
      return;
    }

    const request = ++this.ordersRequest;
    const areaCode = snapshot.area.code;
    const workCenterCode = snapshot.workCenter.code;
    this.syncView();

    this.service.listarOrdensLiberadas(areaCode, workCenterCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: orders => {
        if (!this.isCurrentOrdersRequest(request, areaCode, workCenterCode)) {
          return;
        }
        this.workflow.setOrders(orders);
        this.syncView();
        this.carregarResponsaveis(request, areaCode, workCenterCode);
      },
      error: () => {
        if (!this.isCurrentOrdersRequest(request, areaCode, workCenterCode)) {
          return;
        }
        const message = 'Não foi possível consultar as ordens. Tente novamente.';
        this.workflow.failOrdersQuery(message);
        this.notification.error(message);
        this.syncView();
      },
      });
  }

  atualizarSelecao(ids: ReadonlySet<string>): void {
    this.invalidateTeamContext();
    this.workflow.setSelectedOrderIds(ids);
    this.syncView();
  }

  prepararBatelada(): void {
    this.workflow.prepareBatch();
    this.syncView();
  }

  selecionarResponsavel(responsavel: ResponsavelBatelada | null): void {
    this.workflow.setResponsavel(responsavel);
    this.syncView();
  }

  abrirGerenciarEquipe(acionador?: HTMLElement | null): void {
    if (!this.canManageTeam || !this.view.area || !this.view.workCenter) {
      return;
    }
    const generation = ++this.teamGeneration;
    const areaCode = this.normalizeCode(this.view.area.code);
    const workCenterCode = this.normalizeCode(this.view.workCenter.code);
    this.activeTeamContext = { generation, areaCode, workCenterCode };
    const contexto = {
      areaCode,
      workCenterCode,
      areaLabel: this.view.area.description,
      workCenterLabel: this.view.workCenter.description,
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
      || this.normalizeCode(this.view.area?.code ?? '') !== areaCode
      || this.normalizeCode(this.view.workCenter?.code ?? '') !== workCenterCode
      || !this.sessionActive
      || this.view.composition.length === 0
      || this.contextLocked
    ) {
      return;
    }

    const equipe: ResponsavelBatelada = {
      tipo: 'EQUIPE',
      codigo: this.normalizeCode(resultado.equipe.codigo),
      nome: resultado.equipe.descricao,
    };
    const key = this.responsavelKey(equipe);
    const selectedBefore = this.view.responsavel;
    const merged = new Map<string, ResponsavelBatelada>();
    for (const responsavel of this.view.responsaveis) {
      const canonical = {
        ...responsavel,
        codigo: this.normalizeCode(responsavel.codigo),
      };
      merged.set(this.responsavelKey(canonical), canonical);
    }
    merged.set(key, equipe);
    this.workflow.setResponsaveis([...merged.values()]);
    if (
      resultado.modo === 'nova'
      || (resultado.modo === 'existente' && selectedBefore
        && this.responsavelKey(selectedBefore) === key)
    ) {
      this.workflow.setResponsavel(equipe);
    } else {
      this.workflow.setResponsavel(selectedBefore);
    }
    this.syncView();
  }

  iniciarBatelada(): void {
    if (!this.workflow.beginStart()) {
      return;
    }

    const snapshot = this.workflow.snapshot();
    if (!snapshot.area || !snapshot.workCenter || !snapshot.responsavel) {
      this.workflow.failStart('Selecione um operador elegível antes de iniciar.');
      this.syncView();
      return;
    }

    const request = this.service.montarComandoInicio(
      {
        areaCode: snapshot.area.code,
        workCenterCode: snapshot.workCenter.code,
      },
      snapshot.responsavel,
      snapshot.composition,
    );
    this.syncView();

    const startRequest = ++this.startRequest;
    this.service.iniciarBatelada(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: inicio => {
        if (startRequest !== this.startRequest || !this.sessionActive) {
          return;
        }
        this.workflow.completeStart(inicio);
        this.notification.success('Batelada iniciada com sucesso.');
        this.syncView();
      },
      error: () => {
        if (startRequest !== this.startRequest || !this.sessionActive) {
          return;
        }
        const message = 'Não foi possível iniciar todas as ordens. Os dados foram preservados para nova tentativa.';
        this.workflow.failStart(message);
        this.notification.error(message);
        this.syncView();
      },
      });
  }

  abrirParada(): void {
    if (!this.canReport || !this.view.workCenter || !this.view.responsavel) {
      return;
    }

    this.workflow.enterStop();
    this.syncView();
    this.service.preservarFluxoParada(this.view);
    this.stoppages.setContextFromStartedBatch(
      this.view.workCenter,
      this.view.responsavel,
      this.view.composition,
      this.view.batchId ?? undefined,
    );
    void this.router.navigate(['/stoppages'])
      .then(navigated => {
        if (!navigated) {
          this.rollbackStopNavigation();
        }
      })
      .catch(() => this.rollbackStopNavigation());
  }

  voltar(): void {
    this.navigateProtected(['/work-center']);
  }

  sair(): void {
    this.navigateProtected(['/quality-control']);
  }

  abrirReporte(): void {
    const snapshot = this.workflow.snapshot();
    if (!this.workflow.canReport() || !snapshot.batchId) {
      return;
    }

    this.reportSlide.abrir(snapshot.composition, snapshot.history, snapshot.draft);
    this.workflow.beginHistoryLoad();
    const request = ++this.historyRequest;
    const batchId = snapshot.batchId;
    this.syncView();

    this.service.listarReportesBatelada(batchId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: history => {
          if (!this.isCurrentBatchRequest(request, this.historyRequest, batchId)) {
            return;
          }
          this.workflow.setHistory(history);
          this.syncView();
          this.reportSlide.atualizarHistorico(this.view.history);
        },
        error: () => {
          if (!this.isCurrentBatchRequest(request, this.historyRequest, batchId)) {
            return;
          }
          const message = 'Não foi possível carregar os reportes anteriores.';
          this.workflow.failHistoryLoad(message);
          this.reportSlide.informarErro(message);
          this.notification.error(message);
          this.syncView();
        },
      });
  }

  atualizarRascunho(draft: RascunhoReporteBatelada): void {
    this.workflow.setDraft(draft);
    this.syncView();
  }

  salvarReporte(draft: RascunhoReporteBatelada): void {
    const snapshot = this.workflow.snapshot();
    if (!snapshot.batchId || !draft.idempotencyKey) {
      return;
    }
    if (snapshot.history.some(report => report.idempotencyKey === draft.idempotencyKey)) {
      this.reportSlide.informarErro('Este reporte já foi confirmado no histórico.');
      return;
    }

    this.workflow.setDraft(draft);
    if (!this.workflow.beginReport()) {
      return;
    }
    const request = ++this.reportRequest;
    const batchId = snapshot.batchId;
    this.syncView();

    this.service.reportarBateladaParcial({
      batchId,
      idempotencyKey: draft.idempotencyKey,
      items: draft.items.map(item => ({
        ...item,
        refugoItens: item.refugoItens.map(reason => ({ ...reason })),
      })),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: report => {
          if (!this.isCurrentBatchRequest(request, this.reportRequest, batchId)) {
            return;
          }
          this.workflow.completeReport(report);
          this.reportSlide?.confirmarReporte(report);
          this.notification.success('Reporte parcial salvo com sucesso.');
          this.syncView();
        },
        error: error => {
          if (!this.isCurrentBatchRequest(request, this.reportRequest, batchId)) {
            return;
          }
          const message = error instanceof Error
            ? error.message
            : 'Não foi possível salvar o reporte. O rascunho foi preservado.';
          this.workflow.failReport(message);
          this.reportSlide?.informarErro(message);
          this.notification.error(message);
          this.syncView();
        },
      });
  }

  encerrarBatelada(): void {
    if (!this.workflow.canEnd()) {
      return;
    }
    this.dialog.confirm({
      title: 'Encerrar batelada?',
      message: this.workflow.hasUnsavedDraft()
        ? 'Existem quantidades não salvas. Deseja descartá-las e encerrar conjuntamente todas as ordens desta batelada?'
        : 'Deseja encerrar conjuntamente todas as ordens desta batelada?',
      confirm: () => this.confirmEnding(),
      literals: { cancel: 'Cancelar', confirm: 'Encerrar' },
    });
  }

  tentarCarregarResponsaveisNovamente(): void {
    const retry = this.responsaveisRetry;
    if (!retry) {
      return;
    }
    this.carregarResponsaveis(retry.request, retry.areaCode, retry.workCenterCode);
  }

  private carregarCentros(areaCode: string, prefillCode = ''): void {
    const request = ++this.centersRequest;
    this.loadingCenters = true;
    this.service.pesquisarCentros(areaCode, '')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: centers => {
        if (!this.sessionActive || request !== this.centersRequest || this.workflow.snapshot().area?.code !== areaCode) {
          return;
        }

        this.centers = centers.map(center => ({ ...center }));
        this.loadingCenters = false;
        const selected = this.centers.find(center => center.code === prefillCode) ?? null;
        if (selected) {
          this.workflow.setWorkCenter(selected);
        }
        this.syncView();
      },
      error: () => {
        if (!this.sessionActive || request !== this.centersRequest || this.workflow.snapshot().area?.code !== areaCode) {
          return;
        }
        this.loadingCenters = false;
        this.centers = [];
        this.notification.error('Não foi possível carregar os Centros de Trabalho.');
        this.syncView();
      },
      });
  }

  private carregarResponsaveis(
    request: number,
    areaCode: string,
    workCenterCode: string,
  ): void {
    const responsaveisRequest = ++this.responsaveisRequest;
    this.loadingResponsaveis = true;
    this.service.listarResponsaveisElegiveis(areaCode, workCenterCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: responsaveis => {
        if (
          responsaveisRequest !== this.responsaveisRequest ||
          !this.isCurrentOrdersRequest(request, areaCode, workCenterCode)
        ) {
          return;
        }
        this.loadingResponsaveis = false;
        this.responsaveisErrorMessage = '';
        this.responsaveisRetry = null;
        this.workflow.setResponsaveis(responsaveis, this.preferredOperatorCode);
        this.syncView();
      },
      error: () => {
        if (
          responsaveisRequest !== this.responsaveisRequest ||
          !this.isCurrentOrdersRequest(request, areaCode, workCenterCode)
        ) {
          return;
        }
        this.loadingResponsaveis = false;
        this.responsaveisErrorMessage =
          'Não foi possível carregar os responsáveis elegíveis. Tente novamente.';
        this.responsaveisRetry = { request, areaCode, workCenterCode };
        this.workflow.setResponsaveis([]);
        this.notification.error(this.responsaveisErrorMessage);
        this.syncView();
      },
      });
  }

  private isCurrentOrdersRequest(
    request: number,
    areaCode: string,
    workCenterCode: string,
  ): boolean {
    const snapshot = this.workflow.snapshot();
    return (
      this.sessionActive &&
      request === this.ordersRequest &&
      snapshot.area?.code === areaCode &&
      snapshot.workCenter?.code === workCenterCode
    );
  }

  private confirmEnding(): void {
    const snapshot = this.workflow.snapshot();
    if (!snapshot.batchId || !this.workflow.beginEnding()) {
      return;
    }
    const request = ++this.endingRequest;
    const batchId = snapshot.batchId;
    const orderIds = snapshot.composition.map(order => order.id);
    this.syncView();

    this.service.encerrarBatelada({ batchId, orderIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ending => {
          if (!this.isCurrentBatchRequest(request, this.endingRequest, batchId)) {
            return;
          }
          this.workflow.completeEnding(ending);
          this.notification.success('Batelada encerrada com sucesso.');
          this.syncView();
          void this.router.navigate(['/work-center']);
        },
        error: () => {
          if (!this.isCurrentBatchRequest(request, this.endingRequest, batchId)) {
            return;
          }
          const message = 'Não foi possível encerrar todas as ordens. A batelada foi preservada.';
          this.workflow.failEnding(message);
          this.notification.error(message);
          this.syncView();
        },
      });
  }

  private navigateProtected(commands: ReadonlyArray<string>): void {
    if (!this.started && !this.workflow.hasUnsavedDraft()) {
      this.invalidateTeamContext();
      void this.router.navigate([...commands]);
      return;
    }
    this.dialog.confirm({
      title: 'Sair da batelada?',
      message: 'A batelada está iniciada ou possui alterações não salvas. Deseja sair e descartar o fluxo atual?',
      confirm: () => {
        this.invalidateTeamContext();
        this.historyRequest += 1;
        this.reportRequest += 1;
        this.endingRequest += 1;
        this.startRequest += 1;
        this.workflow.clear();
        this.syncView();
        void this.router.navigate([...commands]);
      },
      literals: { cancel: 'Cancelar', confirm: 'Sair' },
    });
  }

  private isCurrentBatchRequest(request: number, currentRequest: number, batchId: string): boolean {
    return this.sessionActive &&
      request === currentRequest &&
      this.workflow.snapshot().batchId === batchId;
  }

  private rollbackStopNavigation(): void {
    this.service.descartarFluxoParada();
    this.workflow.returnFromStop();
    this.notification.error('Não foi possível abrir o reporte de Paradas.');
    this.syncView();
  }

  private syncView(): void {
    this.view = this.workflow.snapshot();
    this.selectedIds = new Set(this.view.selectedOrderIds);
    this.changeDetector.markForCheck();
  }

  private invalidateTeamContext(): void {
    this.teamGeneration += 1;
    this.activeTeamContext = null;
  }

  private responsavelKey(responsavel: ResponsavelBatelada): string {
    return `${responsavel.tipo}|${this.normalizeCode(responsavel.codigo)}`;
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }
}
