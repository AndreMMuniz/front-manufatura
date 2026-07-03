import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';

import { PoLoadingModule, PoNotificationService, PoPageModule } from '@po-ui/ng-components';

import { RefugoRegistrado, RefugoRegistradoItem, RefugoSlide } from '../../../report-operacao/components/refugo-slide/refugo-slide';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';
import { OperationalContextService } from '../../../shop-floor/services/operational-context';
import { BateladaList } from '../../components/batelada-list/batelada-list';
import { DatasProducao } from '../../components/datas-producao/datas-producao';
import { FooterAcoesBatelada } from '../../components/footer-acoes-batelada/footer-acoes-batelada';
import { InformacoesOperacaoBatelada } from '../../components/informacoes-operacao-batelada/informacoes-operacao-batelada';
import { QuantidadesBatelada } from '../../components/quantidades-batelada/quantidades-batelada';
import { BatchReportState, EstadoBatelada } from '../../models/reporta-batelada.model';
import { ReportaBateladaService } from '../../services/reporta-batelada.service';

@Component({
  selector: 'app-reporta-batelada-page',
  imports: [
    BateladaList,
    DatasProducao,
    FooterAcoesBatelada,
    InformacoesOperacaoBatelada,
    QuantidadesBatelada,
    RefugoSlide,
    PoLoadingModule,
    PoPageModule,
  ],
  templateUrl: './reporta-batelada-page.html',
  styleUrls: ['./reporta-batelada-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportaBateladaPage implements OnInit {
  @ViewChild(RefugoSlide) private refugoSlide?: RefugoSlide;

  private readonly router = inject(Router);
  private readonly operationalContextService = inject(OperationalContextService);
  private readonly service = inject(ReportaBateladaService);
  private readonly reporteParadasService = inject(ReporteParadasService);
  private readonly notification = inject(PoNotificationService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly EstadoBatelada = EstadoBatelada;

  estado = EstadoBatelada.Inicial;
  batelada: BatchReportState | null = null;
  feedback = '';
  refugoItens: ReadonlyArray<RefugoRegistradoItem> = [];

  ngOnInit(): void {
    const context = this.operationalContextService.currentContext;

    if (!context || context.reportType !== 'BATCH') {
      this.feedback = 'Abra Reporta Batelada a partir do Centro de Trabalho.';
      this.notification.warning(this.feedback);
      void this.router.navigate(['/work-center']);
      return;
    }

    this.estado = EstadoBatelada.Carregando;
    this.feedback = 'Carregando batelada...';
    this.service.loadBatch(context).subscribe({
      next: batelada => {
        this.batelada = batelada;
        this.estado = batelada.estado;
        this.feedback = 'Batelada carregada. Selecione as OPs e inicie a produção.';
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.estado = EstadoBatelada.Erro;
        this.feedback = 'Não foi possível carregar a batelada.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  get isBusy(): boolean {
    return this.estado === EstadoBatelada.Carregando || this.estado === EstadoBatelada.Reportando;
  }

  get isLoading(): boolean {
    return this.estado === EstadoBatelada.Carregando;
  }

  get isReporting(): boolean {
    return this.estado === EstadoBatelada.Reportando;
  }

  get hasError(): boolean {
    return this.estado === EstadoBatelada.Erro;
  }

  get canEditProduction(): boolean {
    return (
      this.estado === EstadoBatelada.ProducaoIniciada ||
      this.estado === EstadoBatelada.EmParada ||
      this.estado === EstadoBatelada.Erro
    );
  }

  get primaryLabel(): string {
    return this.canEditProduction ? 'Reportar' : 'Iniciar';
  }

  get primaryDisabled(): boolean {
    return this.isBusy || !this.batelada || this.selectedCount === 0 || this.estado === EstadoBatelada.Reportada;
  }

  get selectedCount(): number {
    return this.batelada?.itens.filter(item => item.selected).length ?? 0;
  }

  atualizarItens(itens: BatchReportState['itens']): void {
    if (!this.batelada) {
      return;
    }

    this.batelada = { ...this.batelada, itens };
  }

  atualizarDatas(datas: Pick<BatchReportState, 'dataInicio' | 'horaInicio' | 'dataFim' | 'horaFim'>): void {
    if (!this.batelada) {
      return;
    }

    this.batelada = { ...this.batelada, ...datas };
  }

  executarAcaoPrincipal(): void {
    if (!this.batelada) {
      return;
    }

    if (this.estado === EstadoBatelada.Carregada || this.estado === EstadoBatelada.Erro) {
      this.iniciarBatelada();
      return;
    }

    if (this.estado === EstadoBatelada.ProducaoIniciada) {
      this.reportarBatelada();
    }
  }

  abrirRefugo(): void {
    if (!this.batelada || !this.canEditProduction) {
      return;
    }

    this.refugoSlide?.abrir(this.batelada.quantidadeRefugo, this.refugoItens);
  }

  registrarRefugo(refugo: RefugoRegistrado): void {
    if (!this.batelada) {
      return;
    }

    this.batelada = {
      ...this.batelada,
      quantidadeRefugo: refugo.quantidade,
    };
    this.refugoItens = refugo.itens.map(item => ({ ...item }));
    this.feedback = 'Refugo registrado para a batelada.';
    this.notification.success('Refugo registrado.');
    this.changeDetector.markForCheck();
  }

  abrirRetrabalho(): void {
    this.feedback = 'Fluxo de retrabalho preparado para implementação futura.';
    this.notification.information(this.feedback);
  }

  abrirParada(): void {
    if (!this.batelada || !this.canEditProduction) {
      return;
    }

    this.estado = EstadoBatelada.EmParada;
    this.reporteParadasService.setContextFromBatch(this.batelada);
    void this.router.navigate(['/stoppages']);
  }

  voltar(): void {
    void this.router.navigate(['/work-center']);
  }

  sair(): void {
    void this.router.navigate(['/menu']);
  }

  private iniciarBatelada(): void {
    if (!this.batelada) {
      return;
    }

    const erro = this.service.validarInicio(this.batelada);

    if (erro) {
      this.feedback = erro;
      this.notification.warning(erro);
      return;
    }

    this.service.startBatch(this.service.toStartRequest(this.batelada)).subscribe({
      next: inicio => {
        if (!this.batelada) {
          return;
        }

        this.batelada = {
          ...this.batelada,
          estado: EstadoBatelada.ProducaoIniciada,
          dataInicio: inicio.dataInicio,
          horaInicio: inicio.horaInicio,
          dataFim: inicio.dataInicio,
          horaFim: inicio.horaInicio,
        };
        this.estado = EstadoBatelada.ProducaoIniciada;
        this.feedback = 'Batelada iniciada. Informe as quantidades para reportar.';
        this.notification.success('Batelada iniciada.');
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.estado = EstadoBatelada.Erro;
        this.feedback = 'Não foi possível iniciar a batelada.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  private reportarBatelada(): void {
    if (!this.batelada) {
      return;
    }

    const finalState = this.ensureFim(this.batelada);
    const erro = this.service.validarReporte(finalState);

    if (erro) {
      this.feedback = erro;
      this.notification.warning(erro);
      return;
    }

    this.batelada = finalState;
    this.estado = EstadoBatelada.Reportando;
    this.feedback = 'Enviando apontamento da batelada ao Datasul...';
    this.service.reportBatch(this.service.toReportRequest(finalState)).subscribe({
      next: resultado => {
        this.estado = EstadoBatelada.Reportada;
        this.feedback = `Batelada reportada com sucesso. Apontamento ${resultado.apontamentoId}.`;
        this.notification.success('Batelada reportada com sucesso.');
        this.changeDetector.markForCheck();
        void this.router.navigate(['/work-center']);
      },
      error: () => {
        this.estado = EstadoBatelada.Erro;
        this.feedback = 'Não foi possível reportar a batelada. Os dados foram preservados.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  private ensureFim(state: BatchReportState): BatchReportState {
    const now = new Date();

    return {
      ...state,
      dataFim: state.dataFim ?? now,
      horaFim: state.horaFim || this.formatTime(now),
    };
  }

  private formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}
