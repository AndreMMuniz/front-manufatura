import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

import { PoButtonModule, PoNotificationService, PoPageModule } from '@po-ui/ng-components';

import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { WorkCenter } from '../../../shop-floor/models/work-center';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { ContextoProducaoBatelada } from '../../components/contexto-producao/contexto-producao';
import { FooterAcoesBatelada } from '../../components/footer-acoes-batelada/footer-acoes-batelada';
import { InformacoesBatelada } from '../../components/informacoes-batelada/informacoes-batelada';
import { OrdensCentroBateladaList } from '../../components/ordens-centro-list/ordens-centro-list';
import { OrdensSelecionadasBatelada } from '../../components/ordens-selecionadas/ordens-selecionadas';
import { AreaProducaoBatelada } from '../../models/reporta-batelada.model';
import { ReportaBateladaService } from '../../services/reporta-batelada.service';
import {
  ReportaBateladaWorkflowSnapshot,
  ReportaBateladaWorkflowState,
} from '../../services/reporta-batelada-workflow-state';

@Component({
  selector: 'app-reporta-batelada-page',
  imports: [
    ContextoProducaoBatelada,
    FooterAcoesBatelada,
    InformacoesBatelada,
    OrdensCentroBateladaList,
    OrdensSelecionadasBatelada,
    PoButtonModule,
    PoPageModule,
  ],
  providers: [ReportaBateladaWorkflowState],
  templateUrl: './reporta-batelada-page.html',
  styleUrls: ['./reporta-batelada-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportaBateladaPage implements OnInit {
  private readonly router = inject(Router);
  private readonly operationalContext = inject(OperationalContextService);
  private readonly stoppages = inject(ReporteParadasService);
  private readonly service = inject(ReportaBateladaService);
  private readonly workflow = inject(ReportaBateladaWorkflowState);
  private readonly notification = inject(PoNotificationService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  areas: ReadonlyArray<AreaProducaoBatelada> = [];
  centers: ReadonlyArray<WorkCenter> = [];
  view: ReportaBateladaWorkflowSnapshot = this.workflow.snapshot();
  selectedIds: ReadonlySet<string> = new Set<string>();
  loadingAreas = false;
  loadingCenters = false;

  private centersRequest = 0;
  private ordersRequest = 0;
  private preferredOperatorCode = '';

  get canStart(): boolean {
    return this.workflow.canStart();
  }

  get started(): boolean {
    return this.view.estado === 'BateladaIniciada';
  }

  ngOnInit(): void {
    const context = this.operationalContext.currentContext;
    const batchContext = context?.reportType === 'BATCH' ? context : null;
    this.preferredOperatorCode = batchContext?.operator.code ?? '';
    this.loadingAreas = true;

    this.service.listarAreas().subscribe({
      next: areas => {
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
        this.loadingAreas = false;
        this.notification.error('Não foi possível carregar as Áreas de Produção.');
        this.syncView();
      },
    });
  }

  selecionarArea(code: string): void {
    const area = this.areas.find(item => item.code === code) ?? null;
    this.ordersRequest += 1;
    this.centers = [];
    this.workflow.setArea(area);
    this.syncView();

    if (area) {
      this.carregarCentros(area.code);
    }
  }

  selecionarCentro(code: string): void {
    this.ordersRequest += 1;
    const center = this.centers.find(item => item.code === code) ?? null;
    this.workflow.setWorkCenter(center);
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

    this.service.listarOrdensLiberadas(areaCode, workCenterCode).subscribe({
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
    this.workflow.setSelectedOrderIds(ids);
    this.syncView();
  }

  prepararBatelada(): void {
    this.workflow.prepareBatch();
    this.syncView();
  }

  selecionarResponsavel(key: string): void {
    const [tipo, codigo] = key.split('|');
    const responsavel =
      this.view.responsaveis.find(item => item.tipo === tipo && item.codigo === codigo) ??
      null;
    this.workflow.setResponsavel(responsavel);
    this.syncView();
  }

  iniciarBatelada(): void {
    if (!this.workflow.beginStart()) {
      return;
    }

    const snapshot = this.workflow.snapshot();
    if (!snapshot.area || !snapshot.workCenter || !snapshot.responsavel) {
      this.workflow.failStart('Selecione um responsável elegível antes de iniciar.');
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

    this.service.iniciarBatelada(request).subscribe({
      next: inicio => {
        this.workflow.completeStart(inicio);
        this.notification.success('Batelada iniciada com sucesso.');
        this.syncView();
      },
      error: () => {
        const message = 'Não foi possível iniciar todas as ordens. Os dados foram preservados para nova tentativa.';
        this.workflow.failStart(message);
        this.notification.error(message);
        this.syncView();
      },
    });
  }

  abrirParada(): void {
    if (!this.started || !this.view.workCenter || !this.view.responsavel) {
      return;
    }

    this.stoppages.setContextFromStartedBatch(
      this.view.workCenter,
      this.view.responsavel,
      this.view.composition,
    );
    void this.router.navigate(['/stoppages']);
  }

  voltar(): void {
    void this.router.navigate(['/work-center']);
  }

  sair(): void {
    void this.router.navigate(['/quality-control']);
  }

  private carregarCentros(areaCode: string, prefillCode = ''): void {
    const request = ++this.centersRequest;
    this.loadingCenters = true;
    this.service.pesquisarCentros(areaCode, '').subscribe({
      next: centers => {
        if (request !== this.centersRequest || this.workflow.snapshot().area?.code !== areaCode) {
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
        if (request !== this.centersRequest) {
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
    this.service.listarResponsaveisElegiveis(areaCode, workCenterCode).subscribe({
      next: responsaveis => {
        if (!this.isCurrentOrdersRequest(request, areaCode, workCenterCode)) {
          return;
        }
        this.workflow.setResponsaveis(responsaveis, this.preferredOperatorCode);
        this.syncView();
      },
      error: () => {
        if (!this.isCurrentOrdersRequest(request, areaCode, workCenterCode)) {
          return;
        }
        this.workflow.setResponsaveis([]);
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
      request === this.ordersRequest &&
      snapshot.area?.code === areaCode &&
      snapshot.workCenter?.code === workCenterCode
    );
  }

  private syncView(): void {
    this.view = this.workflow.snapshot();
    this.selectedIds = new Set(this.view.selectedOrderIds);
    this.changeDetector.markForCheck();
  }
}
