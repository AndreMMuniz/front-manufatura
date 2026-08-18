import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  PoButtonModule,
  PoDialogService,
  PoFieldModule,
  PoNotificationService,
  PoPageSlideComponent,
  PoPageSlideModule,
  PoSelectOption,
} from '@po-ui/ng-components';

import { ProductionOrderRoute } from '../../../quality-control/models/production-order-route';
import { QualityExam, QualityExamComponent } from '../../../quality-control/models/quality-exam';
import {
  AuthorizedComponentResultRequest,
  AuthorizedRouteFinalizationOutcome,
  PendingAuthorizedRoute,
} from '../../models/route-authorization.model';
import { RouteAuthorizationService } from '../../services/route-authorization.service';

export type ComponentSessionStatus =
  | 'unverified' | 'saving' | 'approved' | 'out-of-range' | 'error';

export interface ComponentDraft {
  readonly status: ComponentSessionStatus;
  readonly result: string;
  readonly report: string;
  readonly selectedOptionKey: string;
  readonly message: string;
  readonly isDirty: boolean;
  readonly confirmation?: ComponentDraftConfirmation;
}

interface ComponentDraftConfirmation {
  readonly status: 'approved' | 'out-of-range';
  readonly result: string;
  readonly report: string;
  readonly selectedOptionKey: string;
}

@Component({
  selector: 'app-route-analysis-slide',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './route-analysis-slide.html',
  styleUrls: ['./route-analysis-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteAnalysisSlide {
  @Output() readonly analysisClosed = new EventEmitter<void>();
  @Output() readonly routeFinalized = new EventEmitter<AuthorizedRouteFinalizationOutcome>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  private readonly service = inject(RouteAuthorizationService);
  private readonly dialog = inject(PoDialogService);
  private readonly notification = inject(PoNotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private loadVersion = 0;
  private suppressPageSlideClose = false;
  private isOpen = false;

  readonly route = signal<ProductionOrderRoute | null>(null);
  readonly exams = signal<ReadonlyArray<QualityExam>>([]);
  readonly loading = signal(false);
  readonly finalizing = signal(false);
  readonly feedback = signal('');
  private readonly drafts = signal<Record<string, ComponentDraft>>({});

  readonly canFinalize = computed(() => {
    const components = this.exams().flatMap(exam => exam.components);
    return components.length > 0 && components.every(component => {
      const status = this.statusFor(component);
      return status === 'approved' || status === 'out-of-range';
    });
  });

  open(route: PendingAuthorizedRoute, operationCode: number): void {
    if (this.isOpen || this.loading() || this.finalizing() || this.hasSavingComponent()) {
      this.feedback.set('Feche a análise atual antes de abrir outra ficha.');
      return;
    }

    const version = ++this.loadVersion;
    this.isOpen = true;
    this.route.set(null);
    this.exams.set([]);
    this.drafts.set({});
    this.feedback.set('Carregando ficha para análise...');
    this.loading.set(true);
    this.pageSlide.open();

    this.service.loadRoute(route, operationCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (version !== this.loadVersion) return;
          this.route.set(result.route);
          this.exams.set(result.exams);
          this.drafts.set(initialDrafts(result.exams));
          this.loading.set(false);
          this.feedback.set('Ficha carregada.');
        },
        error: () => {
          if (version !== this.loadVersion) return;
          this.loading.set(false);
          this.feedback.set('Não foi possível carregar a ficha para análise.');
        },
      });
  }

  draftFor(component: QualityExamComponent): ComponentDraft {
    return this.drafts()[this.keyFor(component)] ?? emptyDraft();
  }

  statusFor(component: QualityExamComponent): ComponentSessionStatus {
    return this.draftFor(component).status;
  }

  statusTextFor(component: QualityExamComponent): string {
    const draft = this.draftFor(component);
    switch (draft.status) {
      case 'saving': return 'Salvando resultado...';
      case 'approved': return 'Aprovado pelo Datasul';
      case 'out-of-range': return 'Fora da faixa confirmado pelo Datasul';
      case 'error': return draft.message || 'Não foi possível salvar o resultado';
      default: return 'Não verificado';
    }
  }

  isLocked(component: QualityExamComponent): boolean {
    return this.statusFor(component) === 'approved';
  }

  isSaving(component: QualityExamComponent): boolean {
    return this.statusFor(component) === 'saving';
  }

  isSupported(component: QualityExamComponent): boolean {
    return component.resultType === 1 || component.resultType === 2 || component.resultType === 3;
  }

  tableOptionsFor(component: QualityExamComponent): ReadonlyArray<PoSelectOption> {
    return (component.resultOptions ?? []).map(option => ({
      label: option.description,
      value: optionKey(option.tableNumber, option.sequence),
    }));
  }

  updateResult(component: QualityExamComponent, value: string | number | null | undefined): void {
    this.updateDraft(component, { result: value === null || value === undefined ? '' : String(value) });
  }

  updateSelectedOption(component: QualityExamComponent, value: string | null | undefined): void {
    this.updateDraft(component, { selectedOptionKey: value ?? '' });
  }

  updateReport(component: QualityExamComponent, value: string | null | undefined): void {
    this.updateDraft(component, { report: value ?? '' });
  }

  save(exam: QualityExam, component: QualityExamComponent): void {
    if (this.loading() || this.finalizing() || this.isLocked(component) || this.isSaving(component)) return;
    const request = this.requestFor(component);
    if (!request) return;

    const route = this.route();
    const sheetNumber = route?.nrFicha;
    const examCode = component.examCode ?? positiveInteger(exam.code);
    const componentCode = component.componentCode ?? positiveInteger(component.code);
    if (!sheetNumber || !examCode || !componentCode) {
      this.setDraft(component, { ...this.draftFor(component), status: 'error', message: 'Identidade do componente indisponível.' });
      return;
    }

    this.setDraft(component, { ...this.draftFor(component), status: 'saving', message: '' });
    this.service.saveComponent(sheetNumber, examCode, componentCode, request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          const previous = this.draftFor(component);
          this.setDraft(component, {
            ...previous,
            status: result.withinRange ? 'approved' : 'out-of-range',
            message: result.withinRange
              ? 'Aprovado pelo Datasul.'
              : 'Fora da faixa confirmado pelo Datasul; o resultado continua editável.',
            isDirty: false,
            confirmation: {
              status: result.withinRange ? 'approved' : 'out-of-range',
              result: previous.result,
              report: previous.report,
              selectedOptionKey: previous.selectedOptionKey,
            },
          });
        },
        error: () => {
          const previous = this.draftFor(component);
          this.setDraft(component, {
            ...previous,
            status: 'error',
            message: 'Não foi possível salvar o resultado. O rascunho foi preservado.',
          });
        },
      });
  }

  finalizeRoute(): void {
    const route = this.route();
    if (!route?.nrFicha || !this.canFinalize() || this.finalizing() || this.hasSavingComponent()) return;

    this.dialog.confirm({
      title: `Finalizar ficha ${route.nrFicha} com autorização?`,
      message: 'Esta ação aceitará componentes fora da faixa e não poderá ser desfeita.',
      literals: { cancel: 'Cancelar', confirm: 'Finalizar com autorização' },
      confirm: () => this.confirmFinalization(),
    });
  }

  private confirmFinalization(): void {
    const route = this.route();
    if (!route?.nrFicha || !this.canFinalize() || this.finalizing() || this.hasSavingComponent()) return;

    this.finalizing.set(true);
    this.feedback.set(`Finalizando ficha ${route.nrFicha}...`);
    this.service.finalize(route.nrFicha)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.finalizing.set(false);
          this.feedback.set(result.message);
          this.routeFinalized.emit(result);
          if (result.finalized) {
            this.notification.success(result.message);
            this.close(false);
          }
        },
        error: () => {
          this.finalizing.set(false);
          this.feedback.set('A finalização está indisponível no momento. Tente novamente.');
          this.notification.error(this.feedback());
        },
      });
  }

  requestClose(): void {
    if (this.loading() || this.finalizing() || this.hasSavingComponent()) {
      this.feedback.set('Aguarde a operação em andamento antes de fechar a análise.');
      return;
    }
    if (this.hasUnsavedDraft()) {
      this.dialog.confirm({
        title: 'Descartar resultados não salvos?',
        message: 'Os resultados preenchidos e ainda não salvos serão perdidos.',
        literals: { cancel: 'Continuar analisando', confirm: 'Descartar e fechar' },
        confirm: () => this.close(false),
      });
      return;
    }
    this.close(false);
  }

  onPageSlideClose(): void {
    if (this.suppressPageSlideClose) return;
    if (this.loading() || this.finalizing() || this.hasSavingComponent()) {
      this.pageSlide.open();
      this.feedback.set('Aguarde a operação em andamento antes de fechar a análise.');
      return;
    }
    if (this.hasUnsavedDraft()) {
      this.pageSlide.open();
      this.requestClose();
      return;
    }
    this.close(true);
  }

  private requestFor(component: QualityExamComponent): AuthorizedComponentResultRequest | null {
    const draft = this.draftFor(component);
    if (component.resultType === 1) {
      const result = parseNumericResult(draft.result, component.decimalPlaces);
      if (result === null) {
        this.setDraft(component, { ...draft, status: 'error', message: numericValidationMessage(component.decimalPlaces) });
        return null;
      }
      return { kind: 'numeric', result };
    }
    if (component.resultType === 2) {
      const option = (component.resultOptions ?? []).find(item =>
        optionKey(item.tableNumber, item.sequence) === draft.selectedOptionKey);
      if (!option) {
        this.setDraft(component, { ...draft, status: 'error', message: 'Selecione uma opção válida da tabela.' });
        return null;
      }
      return { kind: 'table', tableNumber: option.tableNumber, optionSequence: option.sequence };
    }
    if (component.resultType === 3) {
      if (!draft.report.trim()) {
        this.setDraft(component, { ...draft, status: 'error', message: 'Informe o laudo para salvar.' });
        return null;
      }
      return { kind: 'report', report: draft.report.trim() };
    }
    this.setDraft(component, { ...draft, status: 'error', message: 'Tipo de resultado não suportado para salvamento.' });
    return null;
  }

  private updateDraft(component: QualityExamComponent, change: Partial<ComponentDraft>): void {
    if (this.isLocked(component) || this.isSaving(component) || this.finalizing()) return;
    const previous = this.draftFor(component);
    const next = { ...previous, ...change };
    const isDirty = next.confirmation
      ? !matchesConfirmation(next, next.confirmation)
      : hasDraftValue(next);
    this.setDraft(component, {
      ...next,
      isDirty,
      status: isDirty ? 'unverified' : next.confirmation?.status ?? 'unverified',
      message: isDirty ? '' : confirmationMessage(next.confirmation),
    });
  }

  private setDraft(component: QualityExamComponent, draft: ComponentDraft): void {
    this.drafts.update(current => ({ ...current, [this.keyFor(component)]: draft }));
  }

  private keyFor(component: QualityExamComponent): string {
    return component.id;
  }

  hasSavingComponent(): boolean {
    return Object.values(this.drafts()).some(draft => draft.status === 'saving');
  }

  private hasUnsavedDraft(): boolean {
    return Object.values(this.drafts()).some(draft => draft.isDirty);
  }

  private close(fromNativeClose: boolean): void {
    ++this.loadVersion;
    this.isOpen = false;
    this.loading.set(false);
    this.finalizing.set(false);
    this.route.set(null);
    this.exams.set([]);
    this.drafts.set({});
    if (!fromNativeClose) {
      this.suppressPageSlideClose = true;
      this.pageSlide.close();
      this.suppressPageSlideClose = false;
    }
    this.analysisClosed.emit();
  }
}

function emptyDraft(): ComponentDraft {
  return {
    status: 'unverified', result: '', report: '', selectedOptionKey: '', message: '', isDirty: false,
  };
}

function matchesConfirmation(draft: ComponentDraft, confirmation: ComponentDraftConfirmation): boolean {
  return draft.result === confirmation.result
    && draft.report === confirmation.report
    && draft.selectedOptionKey === confirmation.selectedOptionKey;
}

function hasDraftValue(draft: ComponentDraft): boolean {
  return Boolean(draft.result.trim() || draft.report.trim() || draft.selectedOptionKey);
}

function confirmationMessage(confirmation: ComponentDraftConfirmation | undefined): string {
  if (!confirmation) return '';
  return confirmation.status === 'approved'
    ? 'Aprovado pelo Datasul.'
    : 'Fora da faixa confirmado pelo Datasul; o resultado continua editável.';
}

function initialDrafts(exams: ReadonlyArray<QualityExam>): Record<string, ComponentDraft> {
  return Object.fromEntries(exams.flatMap(exam => exam.components.map(component =>
    [component.id, emptyDraft()] as const)));
}

function optionKey(tableNumber: number, sequence: number): string {
  return `${tableNumber}:${sequence}`;
}

function parseNumericResult(value: string, decimalPlaces: number | undefined): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const decimals = normalized.split('.')[1]?.length ?? 0;
  if (decimalPlaces !== undefined && decimals > decimalPlaces) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function numericValidationMessage(decimalPlaces: number | undefined): string {
  return decimalPlaces === undefined
    ? 'Informe um resultado numérico válido.'
    : `Informe um resultado numérico válido com até ${decimalPlaces} casas decimais.`;
}

function positiveInteger(value: string): number | null {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : null;
}
