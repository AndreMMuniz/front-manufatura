import { ReportDraftPersistence } from '../../../../core/offline/services/report-draft-persistence.service';
import { MotivoReporte, setReportReason, validateReportReasons } from '../../../../../report-reasons';
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
  readonly schemaVersion?: 2;
  readonly motivos?: ReadonlyArray<MotivoReporte>;
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
  @Input() draftPersistence: ReportDraftPersistence | null = null;
  @Input() draftIdentity = '';
  private activeDraftIdentity = '';
  private draftRevision = 0;
  private restoreRequest = 0;
  restoringDraft = false;
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
  motivoRetrabalhoCodigo = '';
  motivoOptions: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly descricao: string;
    readonly materialScrap?: boolean;
    readonly rework?: boolean;
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
    this.restoreRequest++;
    this.pwaWorkState.setCaptureActive('report-operation', false);
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  get totalInformado(): number {
    return this.quantidadeAprovada + this.quantidadeRefugo;
  }

  get canSave(): boolean {
    return !this.salvando && !this.restoringDraft && this.validationError() === '';
  }

  get motivoObrigatorio(): boolean {
    return this.round3(this.quantidadeRetrabalho) > 0
      || this.round3(this.quantidadeRefugo) > 0;
  }

  get refugoObrigatorio(): boolean { return this.round3(this.quantidadeRefugo) > 0; }
  get retrabalhoObrigatorio(): boolean { return this.round3(this.quantidadeRetrabalho) > 0; }
  get motivosRefugoOptions() { return this.motivoOptions.filter(option => option.materialScrap === true); }
  get motivosRetrabalhoOptions() { return this.motivoOptions.filter(option => option.rework === true); }
  get motivos(): MotivoReporte[] {
    let reasons: MotivoReporte[] = [];
    for (const [field, code] of [['quantidadeRetrabalho', this.motivoRetrabalhoCodigo], ['quantidadeRefugo', this.motivoCodigo]] as const) {
      const option = this.motivoOptions.find(item => item.value === code);
      reasons = setReportReason(reasons, field, this[field], option ? { codigo: option.value, descricao: option.descricao } : undefined);
    }
    return reasons;
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
    if (this.salvando || Object.is(this[campo], quantidade)) {
      return;
    }

    this[campo] = quantidade;
    this.draftRevision++;
    if (campo === 'quantidadeRefugo' && this.round3(quantidade) <= 0) this.motivoCodigo = '';
    if (campo === 'quantidadeRetrabalho' && this.round3(quantidade) <= 0) this.motivoRetrabalhoCodigo = '';
    this.idempotencyKey = '';
    this.validationMessage = '';
    if (campo === 'quantidadeRetrabalho' || campo === 'quantidadeRefugo') {
      if (this.motivoObrigatorio) {
        this.carregarMotivos();
      } else {
        this.motivoCodigo = '';
      }
    }
    this.persistDraft();
  }

  atualizarMotivo(codigo: string | null | undefined, tipo: 'refugo' | 'retrabalho' = 'refugo'): void {
    if (this.salvando) return;
    const field = tipo === 'refugo' ? 'motivoCodigo' : 'motivoRetrabalhoCodigo';
    const motivoCodigo = codigo ?? '';
    if (motivoCodigo !== this[field]) {
      this.idempotencyKey = '';
    }
    this[field] = motivoCodigo;
    this.draftRevision++;
    this.validationMessage = '';
    this.persistDraft();
  }

  abrir(reportes: ReadonlyArray<ReporteParcialOperacao>, finalizarAoSalvar = false): void {
    if (this.activeDraftIdentity !== this.draftIdentity) this.resetDraft();
    this.restoreRequest++;
    this.restoringDraft = false;
    this.activeDraftIdentity = this.draftIdentity;
    this.historico = reportes.map(reporte => ({
      ...reporte,
      registradoEm: new Date(reporte.registradoEm),
      dataInicio: new Date(reporte.dataInicio),
      dataFim: new Date(reporte.dataFim),
      ...(reporte.motivos ? { motivos: reporte.motivos.map(item => ({ ...item })) } : {}),

      refugoItens: (reporte.refugoItens ?? []).map(item => ({ ...item })),
    }));
    if (!this.hasDraft) this.resetDraft();
    if (this.finalizarAoSalvar !== finalizarAoSalvar) this.idempotencyKey = '';
    this.finalizarAoSalvar = finalizarAoSalvar;
    if (!this.hasDraft) this.restorePersistedDraft();
    this.pwaWorkState.setCaptureActive('report-operation', true);
    this.pageSlide.open();
    this.slideOpen = true;
    this.changeDetector.markForCheck();
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
    this.idempotencyKey ||= this.createIdempotencyKey();
    this.persistDraft();
    this.reporteSolicitado.emit({
      idempotencyKey: this.idempotencyKey,
      quantidadeAprovada: this.round3(this.quantidadeAprovada),
      quantidadeRetrabalho: this.round3(this.quantidadeRetrabalho),
      quantidadeRefugo: this.round3(this.quantidadeRefugo),
      schemaVersion: 2,
      motivos: this.motivos,
      refugoItens: [],
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
    this.clearPersistedDraft();
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
        this.clearPersistedDraft();
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

  private persistDraft(): void {
    if (!this.draftPersistence || !this.activeDraftIdentity) return;
    void this.draftPersistence.write(this.activeDraftIdentity, {
      quantidadeAprovada: this.quantidadeAprovada,
      quantidadeRetrabalho: this.quantidadeRetrabalho,
      quantidadeRefugo: this.quantidadeRefugo,
      motivoCodigo: this.motivoCodigo,
      motivoRetrabalhoCodigo: this.motivoRetrabalhoCodigo,
      idempotencyKey: this.idempotencyKey,
      finalizarSplit: this.finalizarAoSalvar,
    }).then(saved => {
      if (!saved) { this.validationMessage = 'Não foi possível preservar o rascunho após recarga nesta aba.'; this.changeDetector.markForCheck(); }
    });
  }

  private restorePersistedDraft(): void {
    if (!this.draftPersistence || !this.activeDraftIdentity) return;
    const identity = this.activeDraftIdentity;
    const revision = this.draftRevision;
    const request = ++this.restoreRequest;
    this.restoringDraft = true;
    void this.draftPersistence.read<Record<string, unknown>>(identity).then(saved => {
      if (request !== this.restoreRequest || identity !== this.activeDraftIdentity || revision !== this.draftRevision) return;
      if (saved && ['quantidadeAprovada', 'quantidadeRetrabalho', 'quantidadeRefugo'].every(field => typeof saved[field] === 'number' && Number.isFinite(saved[field]) && (saved[field] as number) >= 0)) {
        this.quantidadeAprovada = saved['quantidadeAprovada'] as number;
        this.quantidadeRetrabalho = saved['quantidadeRetrabalho'] as number;
        this.quantidadeRefugo = saved['quantidadeRefugo'] as number;
        this.motivoCodigo = typeof saved['motivoCodigo'] === 'string' ? saved['motivoCodigo'] : '';
        this.motivoRetrabalhoCodigo = typeof saved['motivoRetrabalhoCodigo'] === 'string' ? saved['motivoRetrabalhoCodigo'] : '';
        this.idempotencyKey = saved['finalizarSplit'] === this.finalizarAoSalvar && typeof saved['idempotencyKey'] === 'string' ? saved['idempotencyKey'] : '';
        if (this.motivoObrigatorio) this.carregarMotivos();
      }
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

  private resetDraft(): void {
    this.quantidadeAprovada = 0;
    this.quantidadeRetrabalho = 0;
    this.quantidadeRefugo = 0;
    this.idempotencyKey = '';
    this.finalizarAoSalvar = false;
    this.validationMessage = '';
    this.motivoCodigo = '';
    this.motivoRetrabalhoCodigo = '';
  }

  private validationError(): string {
    const quantidades = [
      this.quantidadeAprovada,
      this.quantidadeRetrabalho,
      this.quantidadeRefugo,
    ];
    if (quantidades.some(quantidade => !Number.isFinite(quantidade) || !Number.isFinite(this.round3(quantidade)) || quantidade < 0)) {
      return 'As quantidades não podem ser negativas.';
    }
    if (![this.quantidadeAprovada, this.quantidadeRetrabalho, this.quantidadeRefugo]
      .some(quantidade => this.round3(quantidade) > 0)) {
      return 'Informe ao menos uma quantidade produzida.';
    }
    if (this.retrabalhoObrigatorio && !this.motivosRetrabalhoOptions.some(option => option.value === this.motivoRetrabalhoCodigo)) return 'Informe um motivo de retrabalho elegível.';
    if (this.refugoObrigatorio && !this.motivosRefugoOptions.some(option => option.value === this.motivoCodigo)) return 'Informe um motivo de refugo elegível.';
    return validateReportReasons(this.quantidadeRetrabalho, this.quantidadeRefugo, this.motivos);
  }

  carregarMotivos(retry = false): void {
    if (this.carregandoMotivos || (!retry && this.motivoOptions.length > 0)) return;
    this.carregandoMotivos = true;
    const request = ++this.motivosRequest;
    this.motivoService.buscarMotivos('').pipe(takeUntil(this.destroyed$)).subscribe({
      next: motivos => {
        if (request !== this.motivosRequest) return;
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
