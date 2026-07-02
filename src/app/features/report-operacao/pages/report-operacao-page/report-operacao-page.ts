import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';

import { PoLoadingModule, PoNotificationService, PoPageModule } from '@po-ui/ng-components';

import { OpDetalhesCard } from '../../components/op-detalhes-card/op-detalhes-card';
import { OpIdentificacaoCard } from '../../components/op-identificacao-card/op-identificacao-card';
import { OperacaoInfoCard } from '../../components/operacao-info-card/operacao-info-card';
import { ProducaoChange, ProducaoForm } from '../../components/producao-form/producao-form';
import { RefugoRegistrado, RefugoRegistradoItem, RefugoSlide } from '../../components/refugo-slide/refugo-slide';
import { ReportActions } from '../../components/report-actions/report-actions';
import { ConsultaOPRequest, ReportarOperacaoRequest } from '../../interfaces/report-operacao.dto';
import { EstadoOperacao, ReportOperacao } from '../../models/report-operacao.model';
import { ReportOperacaoService } from '../../services/report-operacao.service';
import { ReporteParadasService } from '../../../reporte-paradas/services/reporte-paradas.service';

@Component({
  selector: 'app-report-operacao-page',
  imports: [
    OpDetalhesCard,
    OpIdentificacaoCard,
    OperacaoInfoCard,
    ProducaoForm,
    RefugoSlide,
    ReportActions,
    PoLoadingModule,
    PoPageModule,
  ],
  templateUrl: './report-operacao-page.html',
  styleUrls: ['./report-operacao-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportOperacaoPage {
  @ViewChild(RefugoSlide) private refugoSlide?: RefugoSlide;

  private readonly router = inject(Router);
  private readonly reportOperacaoService = inject(ReportOperacaoService);
  private readonly reporteParadasService = inject(ReporteParadasService);
  private readonly notification = inject(PoNotificationService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly EstadoOperacao = EstadoOperacao;

  estado = EstadoOperacao.SemOP;
  ordem = '';
  op = '';
  split = '';
  operacao: ReportOperacao | null = null;
  feedback = 'Informe Ordem e OP para consultar a operação.';
  ultimoMotivoRefugo = '';
  refugoItens: ReadonlyArray<RefugoRegistradoItem> = [];

  get isBusy(): boolean {
    return this.estado === EstadoOperacao.Carregando || this.estado === EstadoOperacao.Reportando;
  }

  get canEditProduction(): boolean {
    return this.estado === EstadoOperacao.OperacaoIniciada || this.estado === EstadoOperacao.Erro;
  }

  get canOpenAuxiliaryFlows(): boolean {
    return this.canEditProduction;
  }

  get primaryLabel(): string {
    return this.estado === EstadoOperacao.OperacaoIniciada || this.estado === EstadoOperacao.Erro
      ? 'Reportar'
      : 'Iniciar';
  }

  get primaryDisabled(): boolean {
    if (this.isBusy) {
      return true;
    }

    return this.estado !== EstadoOperacao.OPEncontrada && this.estado !== EstadoOperacao.OperacaoIniciada && this.estado !== EstadoOperacao.Erro;
  }

  consultarOP(request: ConsultaOPRequest): void {
    this.estado = EstadoOperacao.Carregando;
    this.feedback = 'Consultando OP no Datasul...';
    this.operacao = null;
    this.reportOperacaoService.consultarOP(request).subscribe({
      next: resultado => {
        if (!resultado.sucesso || !resultado.operacao) {
          this.estado = EstadoOperacao.SemOP;
          this.feedback = resultado.mensagem ?? 'OP inválida para produção.';
          this.notification.warning(this.feedback);
          this.changeDetector.markForCheck();
          return;
        }

        this.estado = EstadoOperacao.OPEncontrada;
        this.operacao = resultado.operacao;
        this.refugoItens = [];
        this.ordem = resultado.operacao.ordem;
        this.op = resultado.operacao.op;
        this.split = resultado.operacao.split;
        this.feedback = 'OP carregada. Inicie a operação para liberar os apontamentos.';
        this.notification.success('OP carregada.');
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.estado = EstadoOperacao.SemOP;
        this.feedback = 'Não foi possível comunicar com o ERP. Verifique a conexão e tente novamente.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  executarAcaoPrincipal(): void {
    if (this.estado === EstadoOperacao.OPEncontrada) {
      this.iniciarOperacao();
      return;
    }

    if (this.estado === EstadoOperacao.OperacaoIniciada || this.estado === EstadoOperacao.Erro) {
      this.reportarOperacao();
    }
  }

  atualizarProducao(change: ProducaoChange): void {
    if (!this.operacao) {
      return;
    }

    this.operacao = {
      ...this.operacao,
      ...change,
    };
  }

  abrirRefugo(): void {
    if (!this.operacao || !this.canOpenAuxiliaryFlows) {
      return;
    }

    this.refugoSlide?.abrir(this.operacao.quantidadeRefugo, this.refugoItens);
  }

  registrarRefugo(refugo: RefugoRegistrado): void {
    if (!this.operacao) {
      return;
    }

    const operacaoAnterior = this.operacao;
    this.operacao = {
      ...this.operacao,
      quantidadeRefugo: refugo.quantidade,
    };
    const erroValidacao = this.reportOperacaoService.validarReporte(this.operacao);

    if (erroValidacao) {
      this.operacao = operacaoAnterior;
      this.feedback = erroValidacao;
      this.notification.warning(erroValidacao);
      this.changeDetector.markForCheck();
      return;
    }

    this.refugoItens = refugo.itens.map(item => ({ ...item }));
    this.ultimoMotivoRefugo = refugo.motivo;
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

    this.estado = EstadoOperacao.EmParada;
    this.feedback = 'Abrindo reporte de paradas com o contexto da operação.';
    this.reporteParadasService.setContextFromOperation(this.operacao);
    void this.router.navigate(['/stoppages']);
  }

  scanner(): void {
    this.feedback = 'Leitura por scanner ainda não disponível.';
    this.notification.information(this.feedback);
  }

  voltar(): void {
    void this.router.navigate(['/work-center']);
  }

  sair(): void {
    void this.router.navigate(['/menu']);
  }

  private iniciarOperacao(): void {
    if (!this.operacao) {
      return;
    }

    const agora = new Date();
    const horaInicio = this.formatTime(agora);
    this.reportOperacaoService
      .iniciarOperacao({
        ordem: this.operacao.ordem,
        op: this.operacao.op,
        split: this.operacao.split,
        operador: this.operacao.operador,
        equipe: this.operacao.equipe,
        dataInicio: agora,
        horaInicio,
      })
      .subscribe({
        next: inicio => {
          if (!this.operacao) {
            return;
          }

          this.operacao = {
            ...this.operacao,
            dataInicio: inicio.dataInicio,
            horaInicio: inicio.horaInicio,
            dataFim: inicio.dataInicio,
            horaFim: this.formatTime(inicio.dataInicio),
          };
          this.estado = EstadoOperacao.OperacaoIniciada;
          this.feedback = 'Operação iniciada. Informe as quantidades para reportar.';
          this.notification.success('Operação iniciada.');
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.estado = EstadoOperacao.Erro;
          this.feedback = 'Não foi possível iniciar a operação. Tente novamente sem perder os dados carregados.';
          this.notification.error(this.feedback);
          this.changeDetector.markForCheck();
        },
      });
  }

  private reportarOperacao(): void {
    if (!this.operacao) {
      return;
    }

    const fim = this.ensureFim(this.operacao);
    const operacaoFinal = {
      ...this.operacao,
      dataFim: fim.dataFim,
      horaFim: fim.horaFim,
    };
    const erroValidacao = this.reportOperacaoService.validarReporte(operacaoFinal);

    if (erroValidacao) {
      this.feedback = erroValidacao;
      this.notification.warning(erroValidacao);
      return;
    }

    this.operacao = operacaoFinal;
    this.estado = EstadoOperacao.Reportando;
    this.feedback = 'Enviando apontamento ao Datasul...';

    this.reportOperacaoService.reportarOperacao(this.toReportarRequest(operacaoFinal)).subscribe({
      next: resultado => {
        this.estado = EstadoOperacao.Reportada;
        this.feedback = `Operação reportada com sucesso. Apontamento ${resultado.apontamentoId}.`;
        this.notification.success('Operação reportada com sucesso.');
        this.changeDetector.markForCheck();
        void this.router.navigate(['/work-center']);
      },
      error: () => {
        this.estado = EstadoOperacao.Erro;
        this.feedback = 'Não foi possível comunicar com o ERP. Os dados foram preservados para nova tentativa.';
        this.notification.error(this.feedback);
        this.changeDetector.markForCheck();
      },
    });
  }

  private ensureFim(operacao: ReportOperacao): Pick<ReportOperacao, 'dataFim' | 'horaFim'> {
    const agora = new Date();

    return {
      dataFim: operacao.dataFim ?? agora,
      horaFim: operacao.horaFim || this.formatTime(agora),
    };
  }

  private toReportarRequest(operacao: ReportOperacao): ReportarOperacaoRequest {
    return {
      ordem: operacao.ordem,
      op: operacao.op,
      split: operacao.split,
      quantidadeAprovada: operacao.quantidadeAprovada,
      quantidadeRetrabalho: operacao.quantidadeRetrabalho,
      quantidadeRefugo: operacao.quantidadeRefugo,
      refugoItens: this.refugoItens.map(item => ({ ...item })),
      dataInicio: operacao.dataInicio ?? new Date(),
      horaInicio: operacao.horaInicio,
      dataFim: operacao.dataFim ?? new Date(),
      horaFim: operacao.horaFim,
      operador: operacao.operador,
      equipe: operacao.equipe,
      ct: operacao.ct,
    };
  }

  private formatTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}
