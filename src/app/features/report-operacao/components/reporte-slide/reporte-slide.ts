import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, throwError } from 'rxjs';

import {
  PoButtonModule,
  PoDialogService,
  PoFieldModule,
  PoPageSlideComponent,
  PoPageSlideModule,
} from '@po-ui/ng-components';

import {
  ReporteParcialOperacao,
  ReporteRefugoItem,
} from '../../models/report-operacao.model';
import { MotivoRefugoService } from '../../services/motivo-refugo.service';
import { PwaWorkStateService } from '../../../../core/offline/pwa/pwa-work-state.service';
import { IdempotencyService } from '../../../../core/offline/services/idempotency.service';

export interface ReporteParcialDraft {
  readonly idempotencyKey?: string;
  readonly quantidadeAprovada: number;
  readonly quantidadeRetrabalho: number;
  readonly quantidadeRefugo: number;
  readonly refugoItens?: ReadonlyArray<ReporteRefugoItem>;
  readonly finalizarSplit?: boolean;
}

@Component({
  selector: 'app-reporte-slide',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './reporte-slide.html',
  styleUrls: ['./reporte-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteSlide implements OnDestroy {
  @Input() ordem = '';
  @Output() reporteSolicitado = new EventEmitter<ReporteParcialDraft>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  quantidadeAprovada = 0;
  quantidadeRetrabalho = 0;
  quantidadeRefugo = 0;
  historico: ReadonlyArray<ReporteParcialOperacao> = [];
  salvando = false;
  validationMessage = '';
  carregandoMotivos = false;
  motivoCodigo = '';
  motivoOptions: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly descricao: string;
  }> = [];
  private idempotencyKey = '';
  private finalizarAoSalvar = false;
  private motivosRequest = 0;
  private slideOpen = false;
  private readonly destroyed$ = new Subject<void>();

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly dialog: PoDialogService,
    private readonly motivoService: MotivoRefugoService = {
      buscarMotivos: () => throwError(() => new Error('scrap-reasons-api-not-configured')),
    } as unknown as MotivoRefugoService,
    private readonly pwaWorkState: PwaWorkStateService = new PwaWorkStateService(),
    private readonly idempotency: IdempotencyService = new IdempotencyService(
      () => globalThis.crypto,
    ),
  ) {}

  ngOnDestroy(): void {
    this.pwaWorkState.setCaptureActive('report-operation', false);
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  get totalInformado(): number {
    return this.quantidadeAprovada + this.quantidadeRefugo;
  }

  get canSave(): boolean {
    return !this.salvando && this.validationError() === '';
  }

  get motivoObrigatorio(): boolean {
    return this.round3(this.quantidadeRetrabalho) > 0
      || this.round3(this.quantidadeRefugo) > 0;
  }

  get hasDraft(): boolean {
    return [this.quantidadeAprovada, this.quantidadeRetrabalho, this.quantidadeRefugo]
      .some(quantidade => quantidade !== 0)
      || this.motivoCodigo.trim().length > 0;
  }

  get ordemLabel(): string {
    return this.ordem ? ` da Ordem ${this.ordem}` : '';
  }

  atualizarQuantidade(
    campo: 'quantidadeAprovada' | 'quantidadeRetrabalho' | 'quantidadeRefugo',
    valor: number | null | undefined,
  ): void {
    const quantidade = typeof valor === 'number' ? valor : 0;
    if (Object.is(this[campo], quantidade)) {
      return;
    }

    this[campo] = quantidade;
    this.idempotencyKey = '';
    this.validationMessage = '';
    if (campo === 'quantidadeRetrabalho' || campo === 'quantidadeRefugo') {
      if (this.motivoObrigatorio) {
        this.carregarMotivos();
      } else {
        this.motivoCodigo = '';
      }
    }
  }

  atualizarMotivo(codigo: string | null | undefined): void {
    const motivoCodigo = codigo ?? '';
    if (motivoCodigo !== this.motivoCodigo) {
      this.idempotencyKey = '';
    }
    this.motivoCodigo = motivoCodigo;
    this.validationMessage = '';
  }

  abrir(reportes: ReadonlyArray<ReporteParcialOperacao>, finalizarAoSalvar = false): void {
    this.historico = reportes.map(reporte => ({
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
      dataInicio: new Date(reporte.dataInicio),
      dataFim: new Date(reporte.dataFim),
      refugoItens: (reporte.refugoItens ?? []).map(item => ({ ...item })),
    }));
    if (!this.hasDraft) this.resetDraft();
    this.finalizarAoSalvar = finalizarAoSalvar;
    this.pwaWorkState.setCaptureActive('report-operation', true);
    this.pageSlide.open();
    this.slideOpen = true;
    this.changeDetector.markForCheck();
  }

  salvar(): void {
    if (this.salvando) {
      return;
    }

    const error = this.validationError();
    if (error) {
      this.validationMessage = error;
      return;
    }

    this.salvando = true;
    this.validationMessage = '';
    this.idempotencyKey ||= this.createIdempotencyKey();
    const motivo = this.motivoOptions.find(option => option.value === this.motivoCodigo);
    const refugoItens: ReadonlyArray<ReporteRefugoItem> = motivo
      ? [{
          codigo: motivo.value,
          descricao: motivo.descricao,
          quantidade: this.round3(this.quantidadeRetrabalho + this.quantidadeRefugo),
        }]
      : [];
    this.reporteSolicitado.emit({
      idempotencyKey: this.idempotencyKey,
      quantidadeAprovada: this.round3(this.quantidadeAprovada),
      quantidadeRetrabalho: this.round3(this.quantidadeRetrabalho),
      quantidadeRefugo: this.round3(this.quantidadeRefugo),
      refugoItens,
      finalizarSplit: this.finalizarAoSalvar,
    });
  }

  confirmarReporte(reporte: ReporteParcialOperacao): void {
    const confirmed = {
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
      dataInicio: new Date(reporte.dataInicio),
      dataFim: new Date(reporte.dataFim),
      refugoItens: (reporte.refugoItens ?? []).map(item => ({ ...item })),
    };
    const supersededIndex = confirmed.supersedesLocalId
      ? this.historico.findIndex(item =>
          item.id === confirmed.supersedesLocalId
          || item.commandId === confirmed.supersedesLocalId)
      : -1;
    this.historico = supersededIndex < 0
      ? [...this.historico, confirmed]
      : this.historico.flatMap((item, index) => {
          if (index === supersededIndex) return [confirmed];
          return item.id === confirmed.id || item.commandId === confirmed.commandId
            ? []
            : [item];
        });
    this.salvando = false;
    this.resetDraft();
    this.pwaWorkState.setCaptureActive('report-operation', false);
    if (this.slideOpen) {
      this.slideOpen = false;
      this.pageSlide.close();
    }
    this.changeDetector.markForCheck();
  }

  informarErro(message: string): void {
    this.salvando = false;
    this.validationMessage = message;
    this.changeDetector.markForCheck();
  }

  voltar(): void {
    if (!this.hasDraft) {
      this.pwaWorkState.setCaptureActive('report-operation', false);
      if (this.slideOpen) {
        this.slideOpen = false;
        this.pageSlide.close();
      }
      return;
    }

    this.dialog.confirm({
      title: 'Descartar reporte?',
      message: 'Existem quantidades ainda não salvas. Deseja descartá-las?',
      confirm: () => {
        this.resetDraft();
        this.pwaWorkState.setCaptureActive('report-operation', false);
        if (this.slideOpen) {
          this.slideOpen = false;
          this.pageSlide.close();
        }
      },
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
    });
  }

  formatQuantidade(quantidade: number): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(quantidade);
  }

  formatDataHora(data: Date): string {
    if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
      return 'Data inválida';
    }

    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(data);
  }

  private resetDraft(): void {
    this.quantidadeAprovada = 0;
    this.quantidadeRetrabalho = 0;
    this.quantidadeRefugo = 0;
    this.idempotencyKey = '';
    this.finalizarAoSalvar = false;
    this.validationMessage = '';
    this.motivoCodigo = '';
  }

  private validationError(): string {
    const quantidades = [
      this.quantidadeAprovada,
      this.quantidadeRetrabalho,
      this.quantidadeRefugo,
    ];
    if (quantidades.some(quantidade => !Number.isFinite(quantidade) || quantidade < 0)) {
      return 'As quantidades não podem ser negativas.';
    }
    if (![this.quantidadeAprovada, this.quantidadeRetrabalho, this.quantidadeRefugo]
      .some(quantidade => this.round3(quantidade) > 0)) {
      return 'Informe ao menos uma quantidade produzida.';
    }
    if (this.motivoObrigatorio && !this.motivoCodigo.trim()) {
      return `Informe um motivo de Refugo/Retrabalho${this.ordemLabel}.`;
    }
    return '';
  }

  private carregarMotivos(): void {
    if (this.carregandoMotivos || this.motivoOptions.length > 0) return;
    this.carregandoMotivos = true;
    const request = ++this.motivosRequest;
    this.motivoService.buscarMotivos('').pipe(takeUntil(this.destroyed$)).subscribe({
      next: motivos => {
        if (request !== this.motivosRequest) return;
        this.motivoOptions = motivos.map(motivo => ({
          label: `${motivo.codigo} - ${motivo.descricao}`,
          value: motivo.codigo,
          descricao: motivo.descricao,
        }));
        this.carregandoMotivos = false;
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (request !== this.motivosRequest) return;
        this.carregandoMotivos = false;
        this.validationMessage = 'Não foi possível carregar os motivos de Refugo/Retrabalho.';
        this.changeDetector.markForCheck();
      },
    });
  }

  private round3(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private createIdempotencyKey(): string {
    return this.idempotency.resolve();
  }
}
