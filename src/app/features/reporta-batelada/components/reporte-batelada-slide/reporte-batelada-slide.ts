import { ReportDraftPersistence } from '../../../../core/offline/services/report-draft-persistence.service';
import { setReportReason, validateReportReasons } from '../../../../../report-reasons';
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
  @Input() draftPersistence: ReportDraftPersistence | null = null;
  @Input() draftIdentity = '';
  private activeDraftIdentity = '';
  private draftRevision = 0;
  private restoreRequest = 0;
  restoringDraft = false;
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
    readonly materialScrap?: boolean;
    readonly rework?: boolean;
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
    this.restoreRequest++;
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

  get catalogoNecessarioIndisponivel(): boolean {
    return this.items.some(item => (this.positivo(item.quantidadeRefugo) && this.motivosRefugoOptions.length === 0) || (this.positivo(item.quantidadeRetrabalho) && this.motivosRetrabalhoOptions.length === 0));
  }
  get motivosRefugoOptions() { return this.motivoOptions.filter(option => option.materialScrap === true); }
  get motivosRetrabalhoOptions() { return this.motivoOptions.filter(option => option.rework === true); }
  positivo(value: number): boolean { return arredondarQuantidadeBatelada(value) > 0; }
  get canSave(): boolean {
    return !this.salvando && !this.restoringDraft && this.validationError() === '';
  }

  abrir(
    composition: ReadonlyArray<OrdemLiberadaBatelada>,
    history: ReadonlyArray<ReporteParcialBatelada>,
    draft: RascunhoReporteBatelada | null,
    finalizarAoSalvar = false,
  ): void {
    this.restoreRequest++;
    this.restoringDraft = false;
    this.activeDraftIdentity = this.draftIdentity;
    this.historico = this.dedupeHistory(history);
    this.items = this.restoreDraft(composition, draft);
    this.idempotencyKey = draft?.schemaVersion === 2 && draft.finalizarSplit === finalizarAoSalvar ? draft.idempotencyKey : null;
    this.finalizarAoSalvar = finalizarAoSalvar;
    if (!draft || !draft.items.some(item => item.quantidadeAprovada || item.quantidadeRetrabalho || item.quantidadeRefugo)) this.restorePersistedDraft(composition);
    this.salvando = false;
    this.validationMessage = draft && draft.schemaVersion !== 2 && draft.items.some(item => item.refugoItens.length > 0) ? 'Rascunho legado: revise os motivos de refugo e retrabalho antes de salvar.' : '';
    if (this.items.some(item => arredondarQuantidadeBatelada(item.quantidadeRefugo) > 0 || arredondarQuantidadeBatelada(item.quantidadeRetrabalho) > 0)) {
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
      const updated = { ...item, [field]: quantity };
      if (field !== 'quantidadeAprovada') {
        const reason = item.motivos?.find(reason => reason[field] > 0);
        updated.motivos = setReportReason(item.motivos ?? [], field, quantity, reason);
      }
      return updated;
    });
    if (field !== 'quantidadeAprovada' && arredondarQuantidadeBatelada(quantity) > 0) this.carregarMotivos();
    this.draftChanged();
  }

  atualizarMotivo(orderId: string, code: string | null | undefined, tipo: 'refugo' | 'retrabalho' = 'refugo'): void {
    const current = this.items.find(item => item.orderId === orderId);
    if (!current || this.salvando) return;
    const field = tipo === 'refugo' ? 'quantidadeRefugo' : 'quantidadeRetrabalho';
    const option = this.motivoOptions.find(item => item.value === code);
    const motivos = setReportReason(current.motivos ?? [], field, current[field], option ? { codigo: option.value, descricao: option.descricao } : undefined);
    if (JSON.stringify(motivos) === JSON.stringify(current.motivos ?? [])) return;
    this.items = this.items.map(item => item.orderId === orderId ? { ...item, schemaVersion: 2, motivos, refugoItens: [] } : item);
    this.draftChanged();
  }

  motivoSelecionado(item: ItemReporteBatelada, tipo: 'refugo' | 'retrabalho' = 'refugo'): string {
    return item.motivos?.find(reason => reason[tipo === 'refugo' ? 'quantidadeRefugo' : 'quantidadeRetrabalho'] > 0)?.codigo ?? '';
  }

  salvar(): void {
    if (this.salvando || this.restoringDraft) {
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
    this.persistDraft();
    this.reporteSolicitado.emit({ ...this.currentDraft(), items: this.currentDraft().items.map(item => {
      const { legacyReasons, ...commandItem } = item;
      return commandItem;
    }) });
  }

  confirmarReporte(report: ReporteParcialBatelada): void {
    this.clearPersistedDraft();
    this.historico = this.dedupeHistory([...this.historico, report]);
    this.items = this.items.map(item => ({
      ...item,
      quantidadeAprovada: 0,
      quantidadeRetrabalho: 0,
      quantidadeRefugo: 0,
      schemaVersion: 2,
      motivos: [],
      legacyReasons: [],
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
      if (!this.pageSlide.hidden) this.pageSlide.close();
      return;
    }

    this.dialog.confirm({
      title: 'Descartar reporte?',
      message: 'Existem quantidades ainda não salvas. Deseja descartá-las?',
      confirm: () => {
        this.clearPersistedDraft();
        this.items = this.items.map(item => ({
          ...item,
          quantidadeAprovada: 0,
          quantidadeRetrabalho: 0,
          quantidadeRefugo: 0,
          schemaVersion: 2,
      motivos: [],
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
    if (quantities.some(value => !Number.isFinite(arredondarQuantidadeBatelada(value)))) return 'As quantidades devem ser números finitos e não negativos.';
    if (!this.items.some(item =>
      this.positivo(item.quantidadeAprovada) ||
      this.positivo(item.quantidadeRetrabalho) ||
      this.positivo(item.quantidadeRefugo))) {
      return 'Informe ao menos uma quantidade positiva para salvar o reporte.';
    }
    for (const item of this.items) {
      const error = validateReportReasons(item.quantidadeRetrabalho, item.quantidadeRefugo, item.motivos ?? []);
      if (error) return error + ' Ordem ' + item.ordem + '.';
      for (const reason of item.motivos ?? []) {
        if (reason.quantidadeRefugo > 0 && !this.motivosRefugoOptions.some(option => option.value === reason.codigo)) return 'Informe um motivo de refugo elegível.';
        if (reason.quantidadeRetrabalho > 0 && !this.motivosRetrabalhoOptions.some(option => option.value === reason.codigo)) return 'Informe um motivo de retrabalho elegível.';
      }
    }
    return '';
  }

  private draftChanged(): void {
    this.draftRevision++;
    this.idempotencyKey = null;
    this.validationMessage = '';
    this.rascunhoAlterado.emit(this.currentDraft());
    this.persistDraft();
  }

  private persistDraft(): void {
    if (!this.draftPersistence || !this.activeDraftIdentity) return;
    void this.draftPersistence.write(this.activeDraftIdentity, this.currentDraft()).then(saved => {
      if (!saved) { this.validationMessage = 'Não foi possível preservar o rascunho após recarga nesta aba.'; this.changeDetector.markForCheck(); }
    });
  }

  private restorePersistedDraft(composition: ReadonlyArray<OrdemLiberadaBatelada>): void {
    if (!this.draftPersistence || !this.activeDraftIdentity) return;
    const identity = this.activeDraftIdentity;
    const revision = this.draftRevision;
    const request = ++this.restoreRequest;
    this.restoringDraft = true;
    void this.draftPersistence.read<RascunhoReporteBatelada>(identity).then(saved => {
      if (request !== this.restoreRequest || identity !== this.activeDraftIdentity || revision !== this.draftRevision || !saved || saved.schemaVersion !== 2 || !Array.isArray(saved.items)) return;
      if (!saved.items.every(item => item && typeof item === 'object'
        && typeof item.orderId === 'string' && typeof item.ordem === 'string'
        && [item.quantidadeAprovada, item.quantidadeRetrabalho, item.quantidadeRefugo].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
        && Array.isArray(item.refugoItens)
        && (item.motivos === undefined || (Array.isArray(item.motivos) && item.motivos.every(reason => reason && typeof reason.codigo === 'string' && typeof reason.descricao === 'string' && [reason.quantidadeRetrabalho, reason.quantidadeRefugo].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0))))
        && (item.legacyReasons === undefined || (Array.isArray(item.legacyReasons) && item.legacyReasons.every(reason => reason && typeof reason.motivoCode === 'string' && typeof reason.descricao === 'string' && Number.isFinite(reason.quantidade)))))) {
        this.validationMessage = 'O rascunho salvo está inválido. As quantidades atuais foram preservadas.';
        return;
      }
      this.items = this.restoreDraft(composition, saved);
      this.idempotencyKey = saved.finalizarSplit === this.finalizarAoSalvar ? saved.idempotencyKey : null;
      if (this.items.some(item => this.positivo(item.quantidadeRetrabalho) || this.positivo(item.quantidadeRefugo))) this.carregarMotivos();
      this.rascunhoAlterado.emit(this.currentDraft());
    }).catch(() => {
      if (request === this.restoreRequest) this.validationMessage = 'Não foi possível restaurar o rascunho salvo. As quantidades atuais foram preservadas.';
    }).finally(() => { if (request === this.restoreRequest) { this.restoringDraft = false; this.changeDetector.markForCheck(); } });
  }

  private clearPersistedDraft(): void {
    this.restoreRequest++;
    this.restoringDraft = false;
    this.draftRevision++;
    if (this.draftPersistence && this.activeDraftIdentity) void this.draftPersistence.write(this.activeDraftIdentity, null);
  }

  private currentDraft(): RascunhoReporteBatelada {
    return {
      schemaVersion: 2,
      idempotencyKey: this.idempotencyKey,
      items: this.cloneItems(this.items).map(item => ({ ...item,
        quantidadeAprovada: arredondarQuantidadeBatelada(item.quantidadeAprovada),
        quantidadeRetrabalho: arredondarQuantidadeBatelada(item.quantidadeRetrabalho),
        quantidadeRefugo: arredondarQuantidadeBatelada(item.quantidadeRefugo),
        refugoItens: [],
      })),
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
            schemaVersion: 2,
            motivos: current.schemaVersion === 2 ? current.motivos?.map(reason => ({ ...reason })) ?? [] : [],
            legacyReasons: (current.legacyReasons ?? (current.schemaVersion !== 2 ? current.refugoItens : [])).map(reason => ({ ...reason })),
            refugoItens: [],
          }
        : {
            orderId: order.id,
            ordem: order.ordem,
            quantidadeAprovada: 0,
            quantidadeRetrabalho: 0,
            quantidadeRefugo: 0,
            schemaVersion: 2,
      motivos: [],
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
      ...(item.legacyReasons ? { legacyReasons: item.legacyReasons.map(reason => ({ ...reason })) } : {}),
      ...(item.motivos ? { motivos: item.motivos.map(reason => ({ ...reason })) } : {}),

      refugoItens: item.refugoItens.map(reason => ({ ...reason })),
    }));
  }

  carregarMotivos(retry = false): void {
    if (this.carregandoMotivos || (!retry && this.motivoOptions.length > 0)) {
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
            ...motivo,
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
