import { computed, Injectable, signal } from '@angular/core';

import {
  ProductionOrderOperation,
  ProductionOrderRoute,
} from '../models/production-order-route';
import { QualityExam, QualityExamComponent, QualityMeasurement } from '../models/quality-exam';

export interface MeasurementDraft {
  result: string;
  selectedOptionKey: string;
  observation: string;
}

@Injectable()
export class QualityControlWorkflowState {
  readonly orderNumber = signal('');
  readonly operations = signal<ProductionOrderOperation[]>([]);
  readonly selectedOperation = signal<ProductionOrderOperation | undefined>(undefined);
  readonly moveBalance = signal(false);
  readonly route = signal<ProductionOrderRoute | undefined>(undefined);
  readonly exams = signal<QualityExam[]>([]);
  readonly selectedComponentId = signal<string | undefined>(undefined);
  readonly panelOpen = signal(false);
  readonly drafts = signal<Record<string, MeasurementDraft>>({});
  readonly outOfRangeComponents = signal<Record<string, true>>({});
  readonly routeFeedback = signal('');
  readonly inspectionFeedback = signal('');
  readonly examFeedback = signal('');
  readonly isSearching = signal(false);
  readonly isGenerating = signal(false);
  readonly isLoadingExams = signal(false);
  readonly isSaving = signal(false);
  readonly isFinishing = signal(false);
  readonly isStopping = signal(false);
  readonly examLoadFailed = signal(false);

  private contextId = 0;
  private examLoadSucceeded = false;
  private routeAttemptKey: string | null = null;
  private finishAttemptKeys = new Map<string, string>();
  private stopAttemptKey: string | null = null;
  private inspectionAttemptKeys = new Map<string, string>();
  private measurementAttemptKeys = new Map<
    string,
    { readonly fingerprint: string; readonly idempotencyKey: string }
  >();

  readonly components = computed(() =>
    this.exams().flatMap(exam => [...exam.components].sort((left, right) => left.sequence - right.sequence)),
  );
  readonly selectedComponent = computed(() => this.componentById(this.selectedComponentId()));
  readonly selectedExam = computed(() => {
    const componentId = this.selectedComponentId();
    return componentId
      ? this.exams().find(exam => exam.components.some(component => component.id === componentId))
      : undefined;
  });
  readonly completedCount = computed(() =>
    this.components().filter(component => this.isCompleted(component)).length,
  );
  readonly pendingCount = computed(() => this.components().length - this.completedCount());
  readonly progressPercentage = computed(() =>
    this.components().length
      ? Math.round((this.completedCount() / this.components().length) * 100)
      : 0,
  );
  readonly isBusy = computed(() =>
    this.isSearching()
      || this.isGenerating()
      || this.isLoadingExams()
      || this.isSaving()
      || this.isFinishing()
      || this.isStopping(),
  );
  readonly isDirty = computed(() =>
    Object.entries(this.drafts()).some(([componentId, draft]) => {
      const measurement = this.componentById(componentId)?.measurement;
      return !this.sameDraft(draft, measurement);
    }),
  );

  beginOrderLookup(orderNumber: string): number {
    this.contextId += 1;
    this.orderNumber.set(orderNumber.trim());
    this.operations.set([]);
    this.selectedOperation.set(undefined);
    this.clearRouteContext();
    this.isSearching.set(true);
    this.routeFeedback.set('Consultando Ordem no Datasul...');
    return this.contextId;
  }

  completeOrderLookup(
    token: number,
    orderNumber: string,
    operations: ProductionOrderOperation[],
  ): boolean {
    if (!this.isCurrent(token)) return false;
    this.orderNumber.set(orderNumber);
    this.operations.set([...operations]);
    this.isSearching.set(false);
    this.routeFeedback.set(
      operations.length
        ? 'Ordem localizada. Selecione uma operação para gerar o roteiro.'
        : 'Nenhuma operação foi encontrada para esta Ordem.',
    );
    return true;
  }

  failOrderLookup(token: number): void {
    if (!this.isCurrent(token)) return;
    this.isSearching.set(false);
    this.routeFeedback.set('Nao foi possivel consultar a Ordem no Datasul.');
  }

  updateOrderNumber(value: string): void {
    this.contextId += 1;
    this.orderNumber.set(value);
    this.operations.set([]);
    this.selectedOperation.set(undefined);
    this.clearRouteContext();
    this.routeFeedback.set('');
    this.isSearching.set(false);
    this.isGenerating.set(false);
  }

  selectOperation(operation: ProductionOrderOperation): void {
    this.selectedOperation.set(operation);
    this.route.set({
      routeNumber: '',
      processDescription: operation.processDescription,
      currentOrder: this.orderNumber(),
      operationCode: operation.operationCode,
      operationDescription: `${operation.operationCode} - ${operation.operationDescription}`,
      split: operation.split ?? '',
      itemCode: operation.itemCode,
      itemDescription: operation.itemDescription,
    });
    this.routeFeedback.set(`Operação ${operation.operationCode} selecionada.`);
  }

  beginRouteGeneration(): number {
    this.contextId += 1;
    this.isGenerating.set(true);
    this.routeFeedback.set('Gerando roteiro de inspecao...');
    return this.contextId;
  }

  ensureRouteCommandId(create: () => string): string {
    this.routeAttemptKey ??= create();
    return this.routeAttemptKey;
  }

  ensureMeasurementCommandId(
    examId: string,
    componentId: string,
    fingerprint: string,
    create: () => string,
  ): string {
    const identity = `${examId}\u0000${componentId}`;
    const current = this.measurementAttemptKeys.get(identity);
    if (current?.fingerprint === fingerprint) {
      return current.idempotencyKey;
    }
    const idempotencyKey = create();
    this.measurementAttemptKeys.set(identity, { fingerprint, idempotencyKey });
    return idempotencyKey;
  }

  ensureFinishCommandId(examId: string, create: () => string): string {
    const existing = this.finishAttemptKeys.get(examId);
    if (existing) return existing;
    const created = create();
    this.finishAttemptKeys.set(examId, created);
    return created;
  }

  ensureStopCommandId(create: () => string): string {
    this.stopAttemptKey ??= create();
    return this.stopAttemptKey;
  }

  ensureInspectionCommandId(examId: string, create: () => string): string {
    const existing = this.inspectionAttemptKeys.get(examId);
    if (existing) return existing;
    const created = create();
    this.inspectionAttemptKeys.set(examId, created);
    return created;
  }

  measurementCommandIds(examId: string): readonly string[] {
    return this.exams()
      .find(exam => exam.id === examId)
      ?.components
      .flatMap(component => component.measurement?.commandId ?? []) ?? [];
  }

  restoreCommandIdentities(
    finishCommandIds: Readonly<Record<string, string>>,
    inspectionCommandIds: Readonly<Record<string, string>>,
  ): void {
    this.finishAttemptKeys = new Map(Object.entries(finishCommandIds));
    this.inspectionAttemptKeys = new Map(Object.entries(inspectionCommandIds));
  }

  setGeneratedRoute(route: ProductionOrderRoute, token?: number): boolean {
    if (token !== undefined && !this.isCurrent(token)) return false;
    if (token === undefined) this.contextId += 1;
    this.route.set({ ...route });
    this.exams.set([]);
    this.selectedComponentId.set(undefined);
    this.panelOpen.set(false);
    this.drafts.set({});
    this.outOfRangeComponents.set({});
    this.isGenerating.set(false);
    this.isLoadingExams.set(false);
    this.examLoadFailed.set(false);
    this.examLoadSucceeded = false;
    this.routeFeedback.set('Roteiro gerado.');
    return true;
  }

  failRouteGeneration(token: number): void {
    if (!this.isCurrent(token)) return;
    this.isGenerating.set(false);
    this.routeFeedback.set('Nao foi possivel gerar o roteiro.');
  }

  beginExamLoad(): number | null {
    if (!this.route() || this.isLoadingExams() || this.examLoadSucceeded) return null;
    this.isLoadingExams.set(true);
    this.examLoadFailed.set(false);
    this.inspectionFeedback.set('Carregando componentes do roteiro no Datasul...');
    return this.contextId;
  }

  completeExamLoad(token: number, exams: QualityExam[]): boolean {
    if (!this.isCurrent(token) || !this.isLoadingExams()) return false;
    const ordered = exams.map(exam => ({
      ...exam,
      components: [...exam.components].sort((left, right) => left.sequence - right.sequence),
    }));
    this.exams.set(ordered);
    this.isLoadingExams.set(false);
    this.examLoadSucceeded = true;
    const firstPending = this.components().find(component => !this.isCompleted(component));
    this.selectedComponentId.set(firstPending?.id);
    this.inspectionFeedback.set(
      this.components().length
        ? 'Componentes carregados. Inicie pelo componente destacado.'
        : 'Nenhum componente retornado para o roteiro.',
    );
    return true;
  }

  failExamLoad(token: number): void {
    if (!this.isCurrent(token) || !this.isLoadingExams()) return;
    this.isLoadingExams.set(false);
    this.examLoadFailed.set(true);
    this.inspectionFeedback.set('Nao foi possivel carregar os componentes do roteiro.');
  }

  selectComponent(componentId: string): void {
    if (this.componentById(componentId)) this.selectedComponentId.set(componentId);
  }

  openPanel(componentId: string): void {
    this.selectComponent(componentId);
    this.panelOpen.set(true);
    this.examFeedback.set('');
  }

  closePanel(): void {
    this.panelOpen.set(false);
  }

  updateDraft(componentId: string, patch: Partial<MeasurementDraft>): void {
    const component = this.componentById(componentId);
    if (!component) return;
    const current = this.drafts()[componentId] ?? this.draftFromMeasurement(component.measurement);
    this.drafts.update(drafts => ({
      ...drafts,
      [componentId]: { ...current, ...patch },
    }));
  }

  draftFor(componentId: string): MeasurementDraft {
    return this.drafts()[componentId]
      ?? this.draftFromMeasurement(this.componentById(componentId)?.measurement);
  }

  isComponentDirty(componentId: string): boolean {
    const draft = this.drafts()[componentId];
    return draft ? !this.sameDraft(draft, this.componentById(componentId)?.measurement) : false;
  }

  isComponentOutOfRange(componentId: string): boolean {
    return this.componentById(componentId)?.measurement?.withinRange === false
      || Boolean(this.outOfRangeComponents()[componentId]);
  }

  markComponentOutOfRange(componentId: string): void {
    if (!this.componentById(componentId)) return;
    this.outOfRangeComponents.update(components => ({ ...components, [componentId]: true }));
  }

  clearComponentOutOfRange(componentId: string): void {
    if (!this.isComponentOutOfRange(componentId)) return;
    this.outOfRangeComponents.update(components => {
      const next = { ...components };
      delete next[componentId];
      return next;
    });
  }

  discardDraft(componentId: string): void {
    this.drafts.update(drafts => {
      const next = { ...drafts };
      delete next[componentId];
      return next;
    });
    this.clearComponentOutOfRange(componentId);
  }

  discardAllDrafts(): void {
    this.drafts.set({});
    this.outOfRangeComponents.set({});
  }

  applyMeasurement(examId: string, componentId: string, measurement: QualityMeasurement): void {
    this.exams.update(exams => exams.map(exam => exam.id !== examId ? exam : ({
      ...exam,
      components: exam.components.map(component => component.id !== componentId ? component : ({
        ...component,
        measurement: { ...measurement },
        status: measurement.status === 'APPROVED'
          ? 'APPROVED'
          : measurement.status === 'REJECTED'
            ? 'REJECTED'
            : 'IN_PROGRESS',
        inspectedAt: measurement.savedAt,
        operatorId: measurement.operatorId,
      })),
    })));
    this.discardDraft(componentId);
  }

  moveWithinExam(offset: -1 | 1): void {
    const exam = this.selectedExam();
    const currentId = this.selectedComponentId();
    if (!exam || !currentId) return;
    const ordered = [...exam.components].sort((left, right) => left.sequence - right.sequence);
    const currentIndex = ordered.findIndex(component => component.id === currentId);
    const target = ordered[currentIndex + offset];
    if (target) this.selectedComponentId.set(target.id);
  }

  moveToNextPending(currentId: string): void {
    const ordered = this.components();
    const currentIndex = ordered.findIndex(component => component.id === currentId);
    if (currentIndex < 0) return;
    const next = ordered
      .slice(currentIndex + 1)
      .find(component => !this.isCompleted(component));
    if (next) this.selectedComponentId.set(next.id);
  }

  selectNextPendingAndClose(): string | undefined {
    this.panelOpen.set(false);
    const next = this.components().find(component => !this.isCompleted(component));
    this.selectedComponentId.set(next?.id);
    return next?.id;
  }

  completeRouteStop(): void {
    this.contextId += 1;
    this.clearRouteContext();
    this.routeFeedback.set('Roteiro parado. Gere um novo roteiro após a conferência do supervisor.');
  }

  componentById(componentId: string | undefined): QualityExamComponent | undefined {
    return componentId
      ? this.exams().flatMap(exam => exam.components).find(component => component.id === componentId)
      : undefined;
  }

  reset(): void {
    this.contextId += 1;
    this.orderNumber.set('');
    this.operations.set([]);
    this.selectedOperation.set(undefined);
    this.moveBalance.set(false);
    this.routeFeedback.set('');
    this.isSearching.set(false);
    this.isGenerating.set(false);
    this.clearRouteContext();
  }

  private clearRouteContext(): void {
    this.route.set(undefined);
    this.exams.set([]);
    this.selectedComponentId.set(undefined);
    this.panelOpen.set(false);
    this.drafts.set({});
    this.outOfRangeComponents.set({});
    this.inspectionFeedback.set('');
    this.examFeedback.set('');
    this.isLoadingExams.set(false);
    this.isSaving.set(false);
    this.isFinishing.set(false);
    this.isStopping.set(false);
    this.examLoadFailed.set(false);
    this.examLoadSucceeded = false;
    this.routeAttemptKey = null;
    this.finishAttemptKeys.clear();
    this.stopAttemptKey = null;
    this.inspectionAttemptKeys.clear();
    this.measurementAttemptKeys.clear();
  }

  private isCurrent(token: number): boolean {
    return token === this.contextId;
  }

  private isCompleted(component: QualityExamComponent): boolean {
    return Boolean(component.measurement);
  }

  private draftFromMeasurement(measurement?: QualityMeasurement): MeasurementDraft {
    return {
      result: measurement?.result?.toString() ?? '',
      selectedOptionKey: measurement?.selectedOption
        ? `${measurement.selectedOption.tableNumber}:${measurement.selectedOption.sequence}`
        : '',
      observation: measurement?.observation ?? '',
    };
  }

  private sameDraft(draft: MeasurementDraft, measurement?: QualityMeasurement): boolean {
    const saved = this.draftFromMeasurement(measurement);
    return this.normalizeNumber(draft.result) === this.normalizeNumber(saved.result)
      && draft.selectedOptionKey === saved.selectedOptionKey
      && draft.observation.trim() === saved.observation.trim();
  }

  private normalizeNumber(value: string): string {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return '';
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed.toString() : normalized;
  }
}
