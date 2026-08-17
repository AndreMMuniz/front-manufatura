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
  refugoItens: ReadonlyArray<ReporteRefugoItem> = [];
  historico: ReadonlyArray<ReporteParcialOperacao> = [];
  salvando = false;
  validationMessage = '';
  editingRefugo = false;
  carregandoMotivos = false;
  motivoCodigo = '';
  quantidadeMotivo = 0;
  motivoOptions: ReadonlyArray<{ readonly label: string; readonly value: string }> = [];
  private idempotencyKey = '';
  private finalizarAoSalvar = false;
  private motivosRequest = 0;
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

  get hasDraft(): boolean {
    return [this.quantidadeAprovada, this.quantidadeRetrabalho, this.quantidadeRefugo]
      .some(quantidade => quantidade !== 0)
      || this.refugoItens.length > 0
      || this.motivoCodigo.trim().length > 0
      || this.quantidadeMotivo !== 0;
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
  }

  editarRefugo(): void {
    if (this.salvando || this.carregandoMotivos) {
      return;
    }
    if (this.editingRefugo && (this.motivoCodigo.trim() || this.quantidadeMotivo !== 0)) {
      this.validationMessage = 'Adicione ou limpe o motivo em edição antes de recarregar.';
      return;
    }

    this.editingRefugo = true;
    this.carregandoMotivos = true;
    this.motivoCodigo = '';
    this.quantidadeMotivo = 0;
    this.motivoOptions = [];
    this.validationMessage = '';
    const request = ++this.motivosRequest;
    this.motivoService.buscarMotivos('')
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: motivos => {
          if (request !== this.motivosRequest || !this.editingRefugo) {
            return;
          }
          this.motivoOptions = motivos.map(motivo => ({
            label: `${motivo.codigo} - ${motivo.descricao}`,
            value: motivo.codigo,
          }));
          this.carregandoMotivos = false;
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (request !== this.motivosRequest || !this.editingRefugo) {
            return;
          }
          this.motivoOptions = [];
          this.carregandoMotivos = false;
          this.validationMessage = 'Não foi possível carregar os motivos de refugo.';
          this.changeDetector.markForCheck();
        },
      });
  }

  atualizarMotivo(codigo: string | null | undefined): void {
    this.motivoCodigo = codigo ?? '';
    this.validationMessage = '';
  }

  atualizarQuantidadeMotivo(valor: number | null | undefined): void {
    this.quantidadeMotivo = typeof valor === 'number' ? valor : 0;
    this.validationMessage = '';
  }

  adicionarMotivo(): void {
    const option = this.motivoOptions.find(item => item.value === this.motivoCodigo);
    if (!option || !Number.isFinite(this.quantidadeMotivo) || this.quantidadeMotivo <= 0) {
      this.validationMessage = 'Selecione um motivo e informe uma quantidade maior que zero.';
      return;
    }

    const quantidade = this.round3(this.quantidadeMotivo);
    if (quantidade <= 0) {
      this.validationMessage = 'A quantidade do motivo deve possuir valor após o arredondamento para três casas.';
      return;
    }

    const atual = this.refugoItens.find(item => item.codigo === option.value);
    this.refugoItens = atual
      ? this.refugoItens.map(item => item.codigo === option.value
        ? { ...item, quantidade: this.round3(item.quantidade + quantidade) }
        : item)
      : [
          ...this.refugoItens,
          {
            codigo: option.value,
            descricao: option.label.replace(`${option.value} - `, ''),
            quantidade,
          },
        ];
    this.motivoCodigo = '';
    this.quantidadeMotivo = 0;
    this.draftChanged();
  }

  removerMotivo(index: number): void {
    if (this.salvando || index < 0 || index >= this.refugoItens.length) {
      return;
    }

    this.refugoItens = this.refugoItens.filter((_item, itemIndex) => itemIndex !== index);
    this.draftChanged();
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
    this.reporteSolicitado.emit({
      idempotencyKey: this.idempotencyKey,
      quantidadeAprovada: this.round3(this.quantidadeAprovada),
      quantidadeRetrabalho: this.round3(this.quantidadeRetrabalho),
      quantidadeRefugo: this.round3(this.quantidadeRefugo),
      refugoItens: this.refugoItens.map(item => ({
        ...item,
        quantidade: this.round3(item.quantidade),
      })),
      finalizarSplit: this.finalizarAoSalvar,
    });
  }

  confirmarReporte(reporte: ReporteParcialOperacao): void {
    this.historico = [...this.historico, {
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
      dataInicio: new Date(reporte.dataInicio),
      dataFim: new Date(reporte.dataFim),
      refugoItens: (reporte.refugoItens ?? []).map(item => ({ ...item })),
    }];
    this.salvando = false;
    this.resetDraft();
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
      this.pageSlide.close();
      return;
    }

    this.dialog.confirm({
      title: 'Descartar reporte?',
      message: 'Existem quantidades ainda não salvas. Deseja descartá-las?',
      confirm: () => {
        this.resetDraft();
        this.pwaWorkState.setCaptureActive('report-operation', false);
        this.pageSlide.close();
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
    this.refugoItens = [];
    this.idempotencyKey = '';
    this.finalizarAoSalvar = false;
    this.validationMessage = '';
    this.resetReasonEditor();
  }

  private validationError(): string {
    const quantidades = [
      this.quantidadeAprovada,
      this.quantidadeRetrabalho,
      this.quantidadeRefugo,
      ...this.refugoItens.map(item => item.quantidade),
    ];
    if (quantidades.some(quantidade => !Number.isFinite(quantidade) || quantidade < 0)) {
      return 'As quantidades não podem ser negativas.';
    }
    if (![this.quantidadeAprovada, this.quantidadeRetrabalho, this.quantidadeRefugo]
      .some(quantidade => this.round3(quantidade) > 0)) {
      return 'Informe ao menos uma quantidade produzida.';
    }
    if (this.motivoCodigo.trim() || this.quantidadeMotivo !== 0) {
      return 'Adicione ou limpe o motivo em edição antes de salvar o reporte.';
    }

    const requiresReason = this.quantidadeRefugo > 0 || this.quantidadeRetrabalho > 0;
    if (requiresReason && this.refugoItens.length !== 1) {
      return `Informe exatamente um motivo de refugo ou retrabalho${this.ordemLabel}.`;
    }
    if (!requiresReason && this.refugoItens.length !== 0) {
      return `Remova o motivo${this.ordemLabel}, pois não há refugo ou retrabalho.`;
    }
    return '';
  }

  private draftChanged(): void {
    this.idempotencyKey = '';
    this.validationMessage = '';
  }

  private resetReasonEditor(): void {
    this.motivosRequest += 1;
    this.editingRefugo = false;
    this.carregandoMotivos = false;
    this.motivoCodigo = '';
    this.quantidadeMotivo = 0;
    this.motivoOptions = [];
  }

  private round3(value: number): number {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }

  private createIdempotencyKey(): string {
    return this.idempotency.resolve();
  }
}
