import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import {
  PoButtonModule,
  PoDialogService,
  PoFieldModule,
  PoLoadingModule,
  PoNotificationService,
  PoPageSlideComponent,
  PoPageSlideModule,
  PoSelectOption,
} from '@po-ui/ng-components';

import { EquipeContexto } from '../../models/equipe-contexto.model';
import { Equipe } from '../../models/equipe.model';
import { Operador } from '../../models/operador.model';
import { EquipesService } from '../../services/equipes.service';

export type GerenciarEquipeModo = 'nova' | 'existente';
export type GerenciarEquipeState = 'closed' | 'loading' | 'ready' | 'saving' | 'error';
export type GerenciarEquipeErrorKind = 'load' | 'save' | null;

export interface GerenciarEquipeResultado {
  readonly equipe: Equipe;
  readonly modo: GerenciarEquipeModo;
  readonly contexto: EquipeContexto;
}

@Component({
  selector: 'app-gerenciar-equipe-slide',
  imports: [
    CommonModule,
    FormsModule,
    PoButtonModule,
    PoFieldModule,
    PoLoadingModule,
    PoPageSlideModule,
  ],
  templateUrl: './gerenciar-equipe-slide.html',
  styleUrls: ['./gerenciar-equipe-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GerenciarEquipeSlide {
  @Output() readonly equipeSalva = new EventEmitter<GerenciarEquipeResultado>();
  @Output() readonly cancelado = new EventEmitter<void>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;
  @ViewChild('firstControl', { static: true }) private firstControl?: ElementRef<HTMLButtonElement>;

  private readonly equipesService = inject(EquipesService);
  private readonly notification = inject(PoNotificationService);
  private readonly dialog = inject(PoDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private requestVersion = 0;
  private suppressPageSlideClose = false;
  private discardConfirmationPending = false;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private triggerElement: HTMLElement | null = null;
  private emittedForCurrentOpen = false;

  readonly state = signal<GerenciarEquipeState>('closed');
  readonly errorKind = signal<GerenciarEquipeErrorKind>(null);
  readonly contexto = signal<EquipeContexto | null>(null);
  readonly modo = signal<GerenciarEquipeModo>('nova');
  readonly equipesElegiveis = signal<ReadonlyArray<Equipe>>([]);
  readonly equipeSelecionadaCodigo = signal('');
  readonly codigo = signal('');
  readonly descricao = signal('');
  readonly turno = signal('');
  readonly operadores = signal<ReadonlyArray<Operador>>([]);
  readonly termoPesquisa = signal('');
  readonly codigosSelecionados = signal<ReadonlySet<string>>(new Set<string>());
  readonly feedback = signal('');
  private readonly snapshotInicial = signal('');

  readonly operadoresFiltrados = computed(() =>
    this.equipesService.filtrarOperadores(this.operadores(), this.termoPesquisa()),
  );

  readonly todosVisiveisSelecionados = computed(() => {
    const visible = this.operadoresFiltrados();
    return (
      visible.length > 0 && visible.every((item) => this.codigosSelecionados().has(item.codigo))
    );
  });

  readonly equipesOptions = computed<ReadonlyArray<PoSelectOption>>(() =>
    this.equipesElegiveis().map((equipe) => ({
      label: `${equipe.codigo} — ${equipe.descricao}`,
      value: equipe.codigo,
    })),
  );

  readonly possuiAlteracoes = computed(
    () => this.state() !== 'closed' && this.draftKey() !== this.snapshotInicial(),
  );

  abrir(
    contexto: EquipeContexto,
    modoInicial: GerenciarEquipeModo = 'nova',
    acionador?: HTMLElement,
  ): void {
    if (this.state() === 'saving') {
      this.notification.warning('Aguarde o salvamento da equipe em andamento.');
      return;
    }

    const areaCode = this.normalizeCode(contexto.areaCode);
    const workCenterCode = this.normalizeCode(contexto.workCenterCode);
    if (!areaCode || !workCenterCode) {
      this.notification.warning('Informe a Área de Produção e o Centro de Trabalho.');
      return;
    }

    this.requestVersion += 1;
    this.discardConfirmationPending = false;
    this.triggerElement = acionador ?? this.currentActiveElement();
    this.emittedForCurrentOpen = false;
    const areaLabel = this.normalizeLabel(contexto.areaLabel);
    const workCenterLabel = this.normalizeLabel(contexto.workCenterLabel);
    this.contexto.set({
      areaCode,
      workCenterCode,
      ...(areaLabel ? { areaLabel } : {}),
      ...(workCenterLabel ? { workCenterLabel } : {}),
    });
    this.modo.set(modoInicial);
    this.resetDraft();
    this.snapshotInicial.set(this.draftKey());
    this.pageSlide.open();
    this.loadCatalogs();
    this.focusFirstControl();
  }

  onModoChange(modo: GerenciarEquipeModo): void {
    if (this.state() === 'saving' || this.modo() === modo) {
      return;
    }

    this.modo.set(modo);
    this.equipeSelecionadaCodigo.set('');
    this.codigo.set('');
    this.descricao.set('');
    this.turno.set('');
    this.codigosSelecionados.set(new Set<string>());
    this.feedback.set('');
  }

  onSelecionarEquipe(codigo: string | null | undefined): void {
    if (this.state() === 'saving') {
      return;
    }

    const normalized = typeof codigo === 'string' ? this.normalizeCode(codigo) : '';
    const equipe = this.equipesElegiveis().find(
      (item) => this.normalizeCode(item.codigo) === normalized,
    );
    this.equipeSelecionadaCodigo.set(equipe?.codigo ?? '');
    this.codigo.set(equipe?.codigo ?? '');
    this.descricao.set(equipe?.descricao ?? '');
    this.turno.set(equipe?.turno ?? '');
    this.codigosSelecionados.set(new Set(equipe?.operadores.map((item) => item.codigo) ?? []));
    this.feedback.set('');
    this.snapshotInicial.set(this.draftKey());
  }

  onCodigoChange(value: string): void {
    this.codigo.set(value);
    this.feedback.set('');
  }

  onDescricaoChange(value: string): void {
    this.descricao.set(value);
    this.feedback.set('');
  }

  onTurnoChange(value: string): void {
    this.turno.set(value);
    this.feedback.set('');
  }

  onPesquisarOperador(value: string): void {
    this.termoPesquisa.set(value);
  }

  onSelecionarOperador(operador: Operador, selecionado: boolean): void {
    if (this.state() === 'saving') {
      return;
    }

    const selected = new Set(this.codigosSelecionados());
    if (selecionado) {
      selected.add(operador.codigo);
    } else {
      selected.delete(operador.codigo);
    }
    this.codigosSelecionados.set(selected);
    this.feedback.set('');
  }

  onSelecionarTodos(selecionado: boolean): void {
    if (this.state() === 'saving') {
      return;
    }

    const selected = new Set(this.codigosSelecionados());
    for (const operador of this.operadoresFiltrados()) {
      if (selecionado) {
        selected.add(operador.codigo);
      } else {
        selected.delete(operador.codigo);
      }
    }
    this.codigosSelecionados.set(selected);
    this.feedback.set('');
  }

  onSalvar(): void {
    if (
      this.state() === 'closed' ||
      this.state() === 'loading' ||
      this.state() === 'saving' ||
      (this.state() === 'error' && this.errorKind() === 'load')
    ) {
      return;
    }

    const validationMessage = this.validateDraft();
    if (validationMessage) {
      this.feedback.set(validationMessage);
      return;
    }

    const contexto = this.contexto();
    if (!contexto) {
      this.feedback.set('Informe a Área de Produção e o Centro de Trabalho.');
      return;
    }

    const requestVersion = this.requestVersion;
    const modo = this.modo();
    const contextoSalvo = { ...contexto };
    const operadores = [...this.codigosSelecionados()].sort((a, b) => a.localeCompare(b));
    const command$ =
      modo === 'nova'
        ? this.equipesService.criarEquipe({
            areaCode: contexto.areaCode,
            workCenterCode: contexto.workCenterCode,
            codigo: this.codigo().trim(),
            descricao: this.descricao().trim(),
            turno: this.turno().trim(),
            operadores,
          })
        : this.equipesService.atualizarEquipe({
            areaCode: contexto.areaCode,
            workCenterCode: contexto.workCenterCode,
            codigo: this.codigo(),
            operadores,
          });

    this.state.set('saving');
    this.errorKind.set(null);
    this.feedback.set('');
    command$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (equipe) => {
        if (requestVersion !== this.requestVersion || this.emittedForCurrentOpen) {
          return;
        }
        this.emittedForCurrentOpen = true;
        const resultado: GerenciarEquipeResultado = {
          equipe: {
            ...equipe,
            operadores: equipe.operadores.map((operador) => ({ ...operador })),
          },
          modo,
          contexto: { ...contextoSalvo },
        };
        this.notification.success('Equipe salva com sucesso.');
        this.close(false);
        this.equipeSalva.emit(resultado);
      },
      error: (error) => {
        if (requestVersion !== this.requestVersion) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Não foi possível salvar a equipe.';
        this.state.set('error');
        this.errorKind.set('save');
        this.feedback.set(message);
        this.notification.error(message);
      },
    });
  }

  onTentarNovamente(): void {
    if (this.errorKind() === 'load') {
      this.loadCatalogs();
      return;
    }
    if (this.errorKind() === 'save') {
      this.onSalvar();
    }
  }

  onVoltar(): void {
    if (this.state() === 'saving') {
      return;
    }
    this.requestClose();
  }

  onPageSlideClose(): void {
    if (this.suppressPageSlideClose) {
      return;
    }
    if (this.state() === 'closed') {
      return;
    }
    if (this.state() === 'saving') {
      this.pageSlide.open();
      return;
    }
    if (this.possuiAlteracoes()) {
      this.pageSlide.open();
      this.confirmDiscard();
      return;
    }
    this.finalizeNativeClose();
  }

  isSelecionado(operador: Operador): boolean {
    return this.codigosSelecionados().has(operador.codigo);
  }

  private loadCatalogs(): void {
    const contexto = this.contexto();
    if (!contexto) {
      return;
    }

    const requestVersion = ++this.requestVersion;
    this.state.set('loading');
    this.errorKind.set(null);
    this.feedback.set('');
    forkJoin({
      operadores: this.equipesService.listarOperadores(),
      equipes: this.equipesService.listarEquipesElegiveis(
        contexto.areaCode,
        contexto.workCenterCode,
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ operadores, equipes }) => {
          if (requestVersion !== this.requestVersion) {
            return;
          }
          this.operadores.set(operadores);
          this.equipesElegiveis.set(equipes);
          const selectedCode = this.equipeSelecionadaCodigo();
          if (selectedCode) {
            this.onSelecionarEquipe(selectedCode);
          }
          this.state.set('ready');
        },
        error: () => {
          if (requestVersion !== this.requestVersion) {
            return;
          }
          const message = 'Não foi possível carregar equipes e operadores.';
          this.state.set('error');
          this.errorKind.set('load');
          this.feedback.set(message);
          this.notification.error(message);
        },
      });
  }

  private validateDraft(): string {
    const contexto = this.contexto();
    if (!contexto?.areaCode || !contexto.workCenterCode) {
      return 'Informe a Área de Produção e o Centro de Trabalho.';
    }
    if (this.modo() === 'existente' && !this.equipeSelecionadaCodigo()) {
      return 'Selecione uma equipe existente.';
    }
    if (!this.codigo().trim()) {
      return 'Informe o código da equipe.';
    }
    if (!this.descricao().trim()) {
      return 'Informe a descrição da equipe.';
    }
    if (!this.turno().trim()) {
      return 'Informe o turno da equipe.';
    }
    if (this.codigosSelecionados().size === 0) {
      return 'Selecione ao menos um operador.';
    }
    return '';
  }

  private requestClose(): void {
    if (this.possuiAlteracoes()) {
      this.confirmDiscard();
      return;
    }
    this.close(true);
  }

  private confirmDiscard(): void {
    if (this.discardConfirmationPending) {
      return;
    }

    const requestVersion = this.requestVersion;
    this.discardConfirmationPending = true;
    const clearPending = () => {
      if (requestVersion === this.requestVersion) {
        this.discardConfirmationPending = false;
      }
    };

    this.dialog.confirm({
      title: 'Descartar alterações?',
      message: 'Deseja descartar as alterações da equipe?',
      confirm: () => {
        clearPending();
        if (
          requestVersion === this.requestVersion &&
          this.state() !== 'closed' &&
          this.state() !== 'saving'
        ) {
          this.close(true);
        }
      },
      cancel: clearPending,
      close: clearPending,
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
    });
  }

  private close(emitCancellation: boolean): void {
    this.requestVersion += 1;
    this.discardConfirmationPending = false;
    this.clearFocusTimer();
    this.state.set('closed');
    this.suppressPageSlideClose = true;
    this.pageSlide.close();
    this.suppressPageSlideClose = false;
    if (emitCancellation) {
      this.cancelado.emit();
    }
    this.restoreTriggerFocus();
  }

  private finalizeNativeClose(): void {
    this.requestVersion += 1;
    this.discardConfirmationPending = false;
    this.clearFocusTimer();
    this.state.set('closed');
    this.cancelado.emit();
    this.restoreTriggerFocus();
  }

  private resetDraft(): void {
    this.state.set('loading');
    this.errorKind.set(null);
    this.equipesElegiveis.set([]);
    this.equipeSelecionadaCodigo.set('');
    this.codigo.set('');
    this.descricao.set('');
    this.turno.set('');
    this.operadores.set([]);
    this.termoPesquisa.set('');
    this.codigosSelecionados.set(new Set<string>());
    this.feedback.set('');
  }

  private draftKey(): string {
    return JSON.stringify({
      codigo: this.codigo().trim(),
      descricao: this.descricao().trim(),
      turno: this.turno().trim(),
      operadores: [...this.codigosSelecionados()].sort((a, b) => a.localeCompare(b)),
    });
  }

  private focusFirstControl(): void {
    this.clearFocusTimer();
    const requestVersion = this.requestVersion;
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      const element = this.firstControl?.nativeElement;
      if (
        requestVersion === this.requestVersion &&
        this.state() !== 'closed' &&
        typeof element?.focus === 'function'
      ) {
        element.focus();
      }
    }, 0);
  }

  private clearFocusTimer(): void {
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private restoreTriggerFocus(): void {
    const triggerElement = this.triggerElement;
    this.triggerElement = null;
    if (!triggerElement) {
      return;
    }
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      triggerElement.focus();
    }, 0);
  }

  private currentActiveElement(): HTMLElement | null {
    if (
      typeof document === 'undefined' ||
      typeof HTMLElement === 'undefined' ||
      !(document.activeElement instanceof HTMLElement)
    ) {
      return null;
    }
    return document.activeElement;
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizeLabel(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }
}
