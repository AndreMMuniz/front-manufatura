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
  editingOrderId = '';
  motivoCodigo = '';
  quantidadeMotivo = 0;
  motivoOptions: ReadonlyArray<{ readonly label: string; readonly value: string }> = [];
  private idempotencyKey: string | null = null;
  private motivosRequest = 0;
  private readonly destroyed$ = new Subject<void>();

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly dialog: PoDialogService,
    private readonly motivoService: MotivoRefugoService,
  ) {}

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  get totalInformado(): number {
    return arredondarQuantidadeBatelada(this.items.reduce(
      (sum, item) =>
        sum +
        item.quantidadeAprovada +
        item.quantidadeRetrabalho +
        item.quantidadeRefugo,
      0,
    ));
  }

  get hasDraft(): boolean {
    return this.items.some(item =>
      item.quantidadeAprovada !== 0 ||
      item.quantidadeRetrabalho !== 0 ||
      item.quantidadeRefugo !== 0 ||
      item.refugoItens.length > 0) ||
      this.motivoCodigo.trim().length > 0 ||
      this.quantidadeMotivo !== 0;
  }

  get canSave(): boolean {
    return !this.salvando && this.validationError() === '';
  }

  abrir(
    composition: ReadonlyArray<OrdemLiberadaBatelada>,
    history: ReadonlyArray<ReporteParcialBatelada>,
    draft: RascunhoReporteBatelada | null,
  ): void {
    this.historico = this.dedupeHistory(history);
    this.items = this.restoreDraft(composition, draft);
    this.idempotencyKey = draft?.idempotencyKey ?? null;
    this.salvando = false;
    this.validationMessage = '';
    this.resetReasonEditor();
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

    this.items = this.items.map(item =>
      item.orderId === orderId ? { ...item, [field]: quantity } : item);
    this.draftChanged();
  }

  editarRefugo(orderId: string): void {
    if (!this.items.some(item => item.orderId === orderId) || this.salvando) {
      return;
    }
    this.editingOrderId = orderId;
    this.motivoCodigo = '';
    this.quantidadeMotivo = 0;
    const request = ++this.motivosRequest;
    this.motivoService.buscarMotivos('')
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
      next: motivos => {
        if (request !== this.motivosRequest || this.editingOrderId !== orderId) {
          return;
        }
        this.motivoOptions = motivos.map(motivo => ({
          label: `${motivo.codigo} - ${motivo.descricao}`,
          value: motivo.codigo,
        }));
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (request !== this.motivosRequest || this.editingOrderId !== orderId) {
          return;
        }
        this.validationMessage = 'Não foi possível carregar os motivos de refugo.';
        this.changeDetector.markForCheck();
      },
      });
  }

  atualizarMotivo(code: string): void {
    this.motivoCodigo = code ?? '';
    this.validationMessage = '';
  }

  atualizarQuantidadeMotivo(value: number | null | undefined): void {
    this.quantidadeMotivo = typeof value === 'number' ? value : 0;
    this.validationMessage = '';
  }

  adicionarMotivo(): void {
    const option = this.motivoOptions.find(item => item.value === this.motivoCodigo);
    if (!this.editingOrderId || !option || !Number.isFinite(this.quantidadeMotivo) || this.quantidadeMotivo <= 0) {
      this.validationMessage = 'Selecione um motivo e informe uma quantidade maior que zero.';
      return;
    }

    this.items = this.items.map(item => {
      if (item.orderId !== this.editingOrderId) {
        return item;
      }
      const current = item.refugoItens.find(reason => reason.motivoCode === option.value);
      const reasons = current
        ? item.refugoItens.map(reason => reason.motivoCode === option.value
          ? {
              ...reason,
              quantidade: arredondarQuantidadeBatelada(reason.quantidade + this.quantidadeMotivo),
            }
          : reason)
        : [
            ...item.refugoItens,
            {
              motivoCode: option.value,
              descricao: option.label.replace(`${option.value} - `, ''),
              quantidade: this.quantidadeMotivo,
            },
          ];
      return { ...item, refugoItens: reasons };
    });
    this.motivoCodigo = '';
    this.quantidadeMotivo = 0;
    this.draftChanged();
  }

  removerMotivo(orderId: string, reasonIndex: number): void {
    if (this.salvando) {
      return;
    }
    this.items = this.items.map(item => item.orderId === orderId
      ? { ...item, refugoItens: item.refugoItens.filter((_reason, index) => index !== reasonIndex) }
      : item);
    this.draftChanged();
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
    this.salvando = false;
    this.validationMessage = '';
    this.resetReasonEditor();
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
        this.resetReasonEditor();
        this.rascunhoAlterado.emit(this.currentDraft());
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
    if (!Number.isFinite(this.totalInformado)) {
      return 'O total informado excede o limite permitido.';
    }
    if (this.totalInformado <= 0) {
      return 'Informe ao menos uma quantidade positiva para salvar o reporte.';
    }
    for (const item of this.items) {
      const reasonTotal = arredondarQuantidadeBatelada(
        item.refugoItens.reduce((sum, reason) => sum + reason.quantidade, 0),
      );
      if (reasonTotal !== arredondarQuantidadeBatelada(item.quantidadeRefugo)) {
        return `Os motivos de refugo da ordem ${item.ordem} devem totalizar ${this.formatQuantidade(item.quantidadeRefugo)}.`;
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
            refugoItens: current.refugoItens.map(reason => ({ ...reason })),
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

  private resetReasonEditor(): void {
    this.motivosRequest += 1;
    this.editingOrderId = '';
    this.motivoCodigo = '';
    this.quantidadeMotivo = 0;
  }

  private createIdempotencyKey(): string {
    return globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
