import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import {
  PoButtonModule,
  PoDialogService,
  PoFieldModule,
  PoPageSlideComponent,
  PoPageSlideModule,
} from '@po-ui/ng-components';

import { MotivoRefugoService } from '../../../report-operacao/services/motivo-refugo.service';
import { PwaWorkStateService } from '../../../../core/offline/pwa/pwa-work-state.service';
import { IdempotencyService } from '../../../../core/offline/services/idempotency.service';
import {
  arredondarQuantidadeBatelada,
  ItemReporteBatelada,
  OrdemLiberadaBatelada,
  RascunhoReporteBatelada,
  ReporteParcialBatelada,
} from '../../models/reporta-batelada.model';

type QuantityField =
  | 'quantidadeAprovada'
  | 'quantidadeRetrabalho'
  | 'quantidadeRefugo';

@Component({
  selector: 'app-reporte-batelada-slide',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './reporte-batelada-slide.html',
  styleUrls: ['./reporte-batelada-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReporteBateladaSlide implements OnDestroy {
  @Output() reporteSolicitado = new EventEmitter<RascunhoReporteBatelada>();
  @Output() rascunhoAlterado = new EventEmitter<RascunhoReporteBatelada>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  items: ReadonlyArray<ItemReporteBatelada> = [];
  historico: ReadonlyArray<ReporteParcialBatelada> = [];
  salvando = false;
  validationMessage = '';
  carregandoMotivos = false;
  motivoOptions: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly descricao: string;
  }> = [];
  private idempotencyKey: string | null = null;
  private finalizarAoSalvar = false;
  private motivosRequest = 0;
  private readonly destroyed$ = new Subject<void>();

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly dialog: PoDialogService,
    private readonly motivoService: MotivoRefugoService,
    private readonly pwaWorkState: PwaWorkStateService = new PwaWorkStateService(),
    private readonly idempotency: IdempotencyService = new IdempotencyService(
      () => globalThis.crypto,
    ),
  ) {}

  ngOnDestroy(): void {
    this.pwaWorkState.setCaptureActive('batch-report', false);
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  get totalInformado(): number {
    return arredondarQuantidadeBatelada(this.items.reduce(
      (sum, item) =>
        sum +
        item.quantidadeAprovada +
        item.quantidadeRefugo,
      0,
    ));
  }

  get hasDraft(): boolean {
    return this.items.some(item =>
      item.quantidadeAprovada !== 0 ||
      item.quantidadeRetrabalho !== 0 ||
      item.quantidadeRefugo !== 0 ||
      item.refugoItens.length > 0);
  }

  get canSave(): boolean {
    return !this.salvando && this.validationError() === '';
  }

  abrir(
    composition: ReadonlyArray<OrdemLiberadaBatelada>,
    history: ReadonlyArray<ReporteParcialBatelada>,
    draft: RascunhoReporteBatelada | null,
    finalizarAoSalvar = false,
  ): void {
    this.historico = this.dedupeHistory(history);
    this.items = this.restoreDraft(composition, draft);
    this.idempotencyKey = draft?.idempotencyKey ?? null;
    this.finalizarAoSalvar = finalizarAoSalvar;
    this.salvando = false;
    this.validationMessage = '';
    if (this.items.some(item => arredondarQuantidadeBatelada(item.quantidadeRefugo) > 0)) {
      this.carregarMotivos();
    }
    this.pwaWorkState.setCaptureActive('batch-report', true);
    this.pageSlide.open();
    this.changeDetector.markForCheck();
  }

  atualizarHistorico(history: ReadonlyArray<ReporteParcialBatelada>): void {
    this.historico = this.dedupeHistory([...this.historico, ...history]);
    this.changeDetector.markForCheck();
  }

  atualizarQuantidade(orderId: string, field: QuantityField, value: number | null | undefined): void {
    const quantity = typeof value === 'number' ? value : 0;
    const current = this.items.find(item => item.orderId === orderId);
    if (!current || Object.is(current[field], quantity) || this.salvando) {
      return;
    }

    this.items = this.items.map(item => {
      if (item.orderId !== orderId) {
        return item;
      }
      if (field !== 'quantidadeRefugo') {
        return { ...item, [field]: quantity };
      }
      const roundedScrap = arredondarQuantidadeBatelada(quantity);
      return {
        ...item,
        quantidadeRefugo: quantity,
        refugoItens: roundedScrap > 0
          ? item.refugoItens.slice(0, 1).map(reason => ({
              ...reason,
              quantidade: roundedScrap,
            }))
          : [],
      };
    });
    if (field === 'quantidadeRefugo' && arredondarQuantidadeBatelada(quantity) > 0) {
      this.carregarMotivos();
    }
    this.draftChanged();
  }

  atualizarMotivo(orderId: string, code: string | null | undefined): void {
    const current = this.items.find(item => item.orderId === orderId);
    if (!current || this.salvando) {
      return;
    }
    const option = this.motivoOptions.find(item => item.value === (code ?? ''));
    const refugoItens = option && arredondarQuantidadeBatelada(current.quantidadeRefugo) > 0
      ? [{
          motivoCode: option.value,
          descricao: option.descricao,
          quantidade: arredondarQuantidadeBatelada(current.quantidadeRefugo),
        }]
      : [];
    if (
      current.refugoItens.length === refugoItens.length &&
      current.refugoItens[0]?.motivoCode === refugoItens[0]?.motivoCode &&
      Object.is(current.refugoItens[0]?.quantidade, refugoItens[0]?.quantidade)
    ) {
      return;
    }
    this.items = this.items.map(item => item.orderId === orderId
      ? { ...item, refugoItens }
      : item);
    this.draftChanged();
  }

  motivoSelecionado(item: ItemReporteBatelada): string {
    return item.refugoItens[0]?.motivoCode ?? '';
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
    this.idempotencyKey ??= this.createIdempotencyKey();
    this.reporteSolicitado.emit(this.currentDraft());
  }

  confirmarReporte(report: ReporteParcialBatelada): void {
    this.historico = this.dedupeHistory([...this.historico, report]);
    this.items = this.items.map(item => ({
      ...item,
      quantidadeAprovada: 0,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      refugoItens: [],
    }));
    this.idempotencyKey = null;
    this.finalizarAoSalvar = false;
    this.salvando = false;
    this.validationMessage = '';
    this.rascunhoAlterado.emit(this.currentDraft());
    this.changeDetector.markForCheck();
  }

  informarErro(message: string): void {
    this.salvando = false;
    this.validationMessage = message;
    this.changeDetector.markForCheck();
  }

  voltar(): void {
    if (!this.hasDraft) {
      this.pwaWorkState.setCaptureActive('batch-report', false);
      this.pageSlide.close();
      return;
    }

    this.dialog.confirm({
      title: 'Descartar reporte?',
      message: 'Existem quantidades ainda não salvas. Deseja descartá-las?',
      confirm: () => {
        this.items = this.items.map(item => ({
          ...item,
          quantidadeAprovada: 0,
          quantidadeRetrabalho: 0,
          quantidadeRefugo: 0,
          refugoItens: [],
        }));
        this.idempotencyKey = null;
        this.rascunhoAlterado.emit(this.currentDraft());
        this.pwaWorkState.setCaptureActive('batch-report', false);
        this.pageSlide.close();
      },
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
    });
  }

  formatQuantidade(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value);
  }

  formatDataHora(value: Date): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      return 'Data inválida';
    }
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(value);
  }

  private validationError(): string {
    const quantities = this.items.flatMap(item => [
      item.quantidadeAprovada,
      item.quantidadeRetrabalho,
      item.quantidadeRefugo,
      ...item.refugoItens.map(reason => reason.quantidade),
    ]);
    if (quantities.some(value => !Number.isFinite(value) || value < 0)) {
      return 'As quantidades devem ser números finitos e não negativos.';
    }
    const totalQuantidades = this.items.reduce(
      (sum, item) =>
        sum +
        item.quantidadeAprovada +
        item.quantidadeRetrabalho +
        item.quantidadeRefugo,
      0,
    );
    if (!Number.isFinite(totalQuantidades)) {
      return 'O total informado excede o limite permitido.';
    }
    if (!this.items.some(item =>
      item.quantidadeAprovada > 0 ||
      item.quantidadeRetrabalho > 0 ||
      item.quantidadeRefugo > 0)) {
      return 'Informe ao menos uma quantidade positiva para salvar o reporte.';
    }
    for (const item of this.items) {
      const requiresReason = arredondarQuantidadeBatelada(item.quantidadeRefugo) > 0;
      if (requiresReason && item.refugoItens.length !== 1) {
        return `Informe um motivo de refugo para a ordem ${item.ordem}.`;
      }
      if (!requiresReason && item.refugoItens.length !== 0) {
        return `Remova o motivo da ordem ${item.ordem}, pois não há refugo.`;
      }
      if (
        requiresReason &&
        arredondarQuantidadeBatelada(item.refugoItens[0].quantidade) !==
          arredondarQuantidadeBatelada(item.quantidadeRefugo)
      ) {
        return `A quantidade do motivo deve ser igual à quantidade de refugo da ordem ${item.ordem}.`;
      }
    }
    return '';
  }

  private draftChanged(): void {
    this.idempotencyKey = null;
    this.validationMessage = '';
    this.rascunhoAlterado.emit(this.currentDraft());
  }

  private currentDraft(): RascunhoReporteBatelada {
    return {
      idempotencyKey: this.idempotencyKey,
      items: this.cloneItems(this.items),
      finalizarSplit: this.finalizarAoSalvar,
    };
  }

  private restoreDraft(
    composition: ReadonlyArray<OrdemLiberadaBatelada>,
    draft: RascunhoReporteBatelada | null,
  ): ReadonlyArray<ItemReporteBatelada> {
    const byId = new Map(draft?.items.map(item => [item.orderId, item]) ?? []);
    return composition.map(order => {
      const current = byId.get(order.id);
      return current
        ? {
            ...current,
            orderId: order.id,
            ordem: order.ordem,
            refugoItens: current.quantidadeRefugo > 0 && current.refugoItens[0]
              ? [{
                  ...current.refugoItens[0],
                  quantidade: arredondarQuantidadeBatelada(current.quantidadeRefugo),
                }]
              : [],
          }
        : {
            orderId: order.id,
            ordem: order.ordem,
            quantidadeAprovada: 0,
            quantidadeRetrabalho: 0,
            quantidadeRefugo: 0,
            refugoItens: [],
          };
    });
  }

  private dedupeHistory(
    history: ReadonlyArray<ReporteParcialBatelada>,
  ): ReadonlyArray<ReporteParcialBatelada> {
    const ids = new Set<string>();
    const keys = new Set<string>();
    return history
      .filter(report => {
        if (ids.has(report.reporteId) || keys.has(report.idempotencyKey)) {
          return false;
        }
        ids.add(report.reporteId);
        keys.add(report.idempotencyKey);
        return true;
      })
      .map(report => ({
        ...report,
        confirmadoEm: new Date(report.confirmadoEm),
        items: this.cloneItems(report.items),
      }));
  }

  private cloneItems(items: ReadonlyArray<ItemReporteBatelada>): ReadonlyArray<ItemReporteBatelada> {
    return items.map(item => ({
      ...item,
      refugoItens: item.refugoItens.map(reason => ({ ...reason })),
    }));
  }

  private carregarMotivos(): void {
    if (this.carregandoMotivos || this.motivoOptions.length > 0) {
      return;
    }
    this.carregandoMotivos = true;
    const request = ++this.motivosRequest;
    this.motivoService.buscarMotivos('')
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: motivos => {
          if (request !== this.motivosRequest) {
            return;
          }
          this.motivoOptions = motivos.map(motivo => ({
            label: `${motivo.codigo} - ${motivo.descricao}`,
            value: motivo.codigo,
            descricao: motivo.descricao,
          }));
          this.carregandoMotivos = false;
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (request !== this.motivosRequest) {
            return;
          }
          this.carregandoMotivos = false;
          this.validationMessage = 'Não foi possível carregar os motivos de refugo.';
          this.changeDetector.markForCheck();
        },
      });
  }

  private createIdempotencyKey(): string {
    return this.idempotency.resolve();
  }
}
