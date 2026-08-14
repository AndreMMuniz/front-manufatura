import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, concatMap, Observable, of, tap } from 'rxjs';

import { PoButtonModule, PoDialogService, PoFieldModule, PoIconModule, PoProgressModule, PoWidgetModule } from '@po-ui/ng-components';

import { SaveMeasurementResponse } from '../../models/inspection-record';
import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';
import { OperatorService } from '../../../shop-floor/services/operator';
import { IdempotencyService } from '../../../../core/offline/services/idempotency.service';

@Component({
  selector: 'app-exam-entry-panel',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoIconModule, PoProgressModule, PoWidgetModule],
  templateUrl: './exam-entry-panel.html',
  styleUrls: ['./exam-entry-panel.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExamEntryPanel implements AfterViewInit {
  @Output() panelClosed = new EventEmitter<string | undefined>();
  @ViewChild('panelTitle', { read: ElementRef }) private panelTitle?: ElementRef<HTMLElement>;

  readonly workflow = inject(QualityControlWorkflowState);
  private readonly qualityControlService = inject(QualityControlService);
  private readonly operatorService = inject(OperatorService);
  private readonly dialog = inject(PoDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly idempotency = inject(IdempotencyService);

  validationMessage = '';
  stopReason = '';
  stopValidationMessage = '';
  private validationIsOutOfRange = false;
  private finalizationQueued = false;

  ngAfterViewInit(): void {
    this.panelTitle?.nativeElement.focus();
  }

  get exam() { return this.workflow.selectedExam(); }
  get currentCharacteristic() { return this.workflow.selectedComponent(); }
  get characteristics() { return this.exam?.components ?? []; }
  get currentIndex(): number {
    return this.characteristics.findIndex(component => component.id === this.currentCharacteristic?.id);
  }
  get result(): string { return this.currentCharacteristic ? this.workflow.draftFor(this.currentCharacteristic.id).result : ''; }
  get report(): string { return this.currentCharacteristic ? this.workflow.draftFor(this.currentCharacteristic.id).report : ''; }
  get selectedOptionKey(): string { return this.currentCharacteristic ? this.workflow.draftFor(this.currentCharacteristic.id).selectedOptionKey : ''; }
  get resultOptions(): readonly { label: string; value: string }[] {
    return (this.currentCharacteristic?.resultOptions ?? []).map(option => ({
      label: option.description,
      value: `${option.tableNumber}:${option.sequence}`,
    }));
  }
  get hasResultOptions(): boolean { return this.resultOptions.length > 0; }
  get isReportResult(): boolean { return this.currentCharacteristic?.resultType === 3; }
  get observation(): string { return this.currentCharacteristic ? this.workflow.draftFor(this.currentCharacteristic.id).observation : ''; }
  set observation(value: string) {
    if (this.currentCharacteristic && !this.isCurrentMeasurementLocked) {
      this.workflow.updateDraft(this.currentCharacteristic.id, { observation: value });
    }
  }
  get progressText(): string { return this.characteristics.length ? `${this.currentIndex + 1} / ${this.characteristics.length}` : '0 / 0'; }
  get completedCount(): number { return this.characteristics.filter(item => Boolean(item.measurement)).length; }
  get progressPercentage(): number { return this.characteristics.length ? Math.round((this.completedCount / this.characteristics.length) * 100) : 0; }
  get canGoPrevious(): boolean { return this.currentIndex > 0 && !this.workflow.isBusy(); }
  get canGoNext(): boolean {
    return this.currentIndex >= 0
      && this.currentIndex < this.characteristics.length - 1
      && !this.workflow.isBusy();
  }
  get isExamComplete(): boolean {
    return this.workflow.components().length > 0
      && this.workflow.completedCount() === this.workflow.components().length;
  }
  get hasRejectedMeasurement(): boolean {
    return this.workflow.components().some(item => item.measurement?.withinRange === false);
  }
  get showStopRoute(): boolean {
    return this.isExamComplete && this.hasRejectedMeasurement;
  }
  get canCompleteExam(): boolean {
    return this.isExamComplete
      && !this.hasRejectedMeasurement
      && !this.finalizationQueued
      && !this.workflow.isBusy();
  }
  get canStopRoute(): boolean {
    return this.showStopRoute && !this.workflow.isBusy();
  }
  get isCurrentMeasurementLocked(): boolean { return Boolean(this.currentCharacteristic?.measurement); }
  get hasOutOfRangeAlert(): boolean {
    return this.validationIsOutOfRange
      || this.currentCharacteristic?.measurement?.withinRange === false;
  }
  get outOfRangeMessage(): string {
    return this.currentCharacteristic?.measurement?.withinRange === false
      ? 'Resultado fora da faixa segundo o Datasul'
      : this.validationMessage;
  }
  get currentMeasurementReference(): string {
    return this.currentCharacteristic
      ? `${this.currentCharacteristic.reference} ${this.currentCharacteristic.unit}`.trim() || '-'
      : '-';
  }

  updateResult(value: string): void {
    if (this.currentCharacteristic && !this.isCurrentMeasurementLocked) {
      this.workflow.clearComponentOutOfRange(this.currentCharacteristic.id);
      this.workflow.updateDraft(this.currentCharacteristic.id, { result: this.sanitizeNumericInput(value) });
    }
  }

  updateReport(value: string): void {
    if (this.currentCharacteristic && !this.isCurrentMeasurementLocked) {
      this.workflow.updateDraft(this.currentCharacteristic.id, { report: value });
    }
  }

  updateSelectedOption(value: string): void {
    if (this.currentCharacteristic && !this.isCurrentMeasurementLocked) {
      this.workflow.clearComponentOutOfRange(this.currentCharacteristic.id);
      this.workflow.updateDraft(this.currentCharacteristic.id, { selectedOptionKey: value });
    }
  }

  saveCurrentMeasurement(): Observable<SaveMeasurementResponse | null> {
    const exam = this.exam;
    const characteristic = this.currentCharacteristic;
    if (!exam || !characteristic || this.workflow.isSaving() || this.isCurrentMeasurementLocked) {
      return of(null);
    }
    this.clearValidation();
    const draft = this.workflow.draftFor(characteristic.id);
    const selectedOption = characteristic.resultOptions?.find(
      option => `${option.tableNumber}:${option.sequence}` === draft.selectedOptionKey,
    );
    const report = this.isReportResult ? draft.report.trim() : null;
    const result = this.hasResultOptions || this.isReportResult
      ? null
      : this.parseNumber(draft.result);
    if (this.hasResultOptions ? !selectedOption : this.isReportResult ? !report : result === null) {
      this.validationMessage = this.hasResultOptions
        ? 'Selecione uma opção de resultado.'
        : this.isReportResult
          ? 'Informe o laudo.'
          : 'Informe um resultado numérico.';
      return of(null);
    }
    if (result !== null && !this.hasSupportedPrecision(draft.result, characteristic.decimalPlaces)) {
      this.validationMessage = `Informe no máximo ${characteristic.decimalPlaces} casa(s) decimal(is).`;
      return of(null);
    }
    if (result !== null && (result < characteristic.minValue || result > characteristic.maxValue)) {
      this.validationMessage = 'Resultado fora da referência; a decisão final será retornada pelo Datasul.';
      this.validationIsOutOfRange = true;
    }

    this.workflow.isSaving.set(true);
    this.workflow.examFeedback.set('Salvando medição...');
    const route = this.workflow.route();
    if (!route?.routeNumber) {
      this.workflow.isSaving.set(false);
      this.workflow.examFeedback.set('O roteiro local não possui identidade confirmada.');
      return of(null);
    }
    const fingerprint = JSON.stringify({
      result,
      report,
      selectedOptionKey: draft.selectedOptionKey,
      observation: draft.observation.trim(),
      operatorId: this.operatorService.selectedOperator?.code ?? '',
    });
    let idempotencyKey: string;
    try {
      idempotencyKey = this.workflow.ensureMeasurementCommandId(
        exam.id,
        characteristic.id,
        fingerprint,
        () => this.idempotency.resolve(),
      );
    } catch {
      this.workflow.isSaving.set(false);
      this.workflow.examFeedback.set('Não foi possível gerar a identidade segura do resultado.');
      return of(null);
    }
    const dependencyIds = [
      ...(route.creationCommandId ? [route.creationCommandId] : []),
      ...this.workflow.measurementCommandIds(exam.id).slice(-1),
    ];
    return this.qualityControlService.saveMeasurement({
      orderNumber: route.currentOrder,
      examId: exam.id,
      componentId: characteristic.id,
      routeNumber: route.routeNumber,
      nrFicha: route.nrFicha ?? Number(route.routeNumber),
      examCode: characteristic.examCode ?? Number(exam.code),
      componentCode: characteristic.componentCode ?? Number(characteristic.code),
      ...(selectedOption ? {
        tableNumber: selectedOption.tableNumber,
        optionSequence: selectedOption.sequence,
      } : {}),
      idempotencyKey,
      dependencyIds,
      measurement: {
        ...(result !== null ? { result } : {}),
        ...(report ? { report } : {}),
        ...(selectedOption ? { selectedOption } : {}),
        observation: draft.observation.trim() || undefined,
        status: 'RECORDED',
      },
      operatorId: this.operatorService.selectedOperator?.code ?? '',
    }).pipe(
      tap(response => {
        this.workflow.applyMeasurement(exam.id, characteristic.id, response.measurement);
        if (response.idempotencyKey) {
          this.qualityControlService.watchMeasurementDelivery(response.idempotencyKey)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(update => {
              const current = this.workflow.componentById(characteristic.id)?.measurement;
              if (!current) return;
              this.workflow.applyMeasurement(exam.id, characteristic.id, {
                ...current,
                ...update,
                status: update.withinRange === true
                  ? 'APPROVED'
                  : update.withinRange === false
                    ? 'REJECTED'
                    : 'RECORDED',
              });
            });
        }
        this.workflow.isSaving.set(false);
        this.workflow.examFeedback.set('Salvo neste dispositivo — envio pendente.');
        this.validationIsOutOfRange = false;
        if (!this.showStopRoute) {
          this.workflow.moveToNextPending(characteristic.id);
        }
      }),
      catchError(() => {
        this.workflow.isSaving.set(false);
        this.workflow.examFeedback.set('Nao foi possivel salvar a medição. Tente novamente.');
        return of(null);
      }),
      takeUntilDestroyed(this.destroyRef),
    );
  }

  goPrevious(): void {
    if (this.canGoPrevious) { this.clearValidation(); this.workflow.moveWithinExam(-1); }
  }

  goNext(): void {
    if (this.canGoNext) { this.clearValidation(); this.workflow.moveWithinExam(1); }
  }

  updateStopReason(value: string): void {
    this.stopReason = value;
    if (value.trim()) this.stopValidationMessage = '';
  }

  closePanel(): void {
    const close = () => { this.workflow.closePanel(); this.panelClosed.emit(); };
    if (!this.workflow.isDirty()) { close(); return; }
    this.dialog.confirm({
      title: 'Fechar digitação?',
      message: 'Todas as medições não salvas abertas na digitação serão descartadas.',
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
      confirm: () => { this.workflow.discardAllDrafts(); close(); },
    });
  }

  completeExam(): void {
    const exam = this.exam;
    const route = this.workflow.route();
    if (!exam || !route?.routeNumber || !this.canCompleteExam) return;
    this.workflow.isFinishing.set(true);
    this.workflow.examFeedback.set('Concluindo exame...');
    const measurementCommandIds = this.workflow.exams()
      .flatMap(item => this.workflow.measurementCommandIds(item.id));
    let finishCommandId: string;
    try {
      finishCommandId = this.workflow.ensureFinishCommandId(
        route.routeNumber,
        () => this.idempotency.resolve(),
      );
    } catch {
      this.workflow.isFinishing.set(false);
      this.workflow.examFeedback.set(
        'Não foi possível gerar a identidade segura da finalização.',
      );
      return;
    }
    this.qualityControlService.finishExam({
      examId: `route-${route.routeNumber}`,
      routeNumber: route.routeNumber,
      idempotencyKey: finishCommandId,
      dependencyIds: [
        ...measurementCommandIds,
      ],
    })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.workflow.isFinishing.set(false);
          this.finalizationQueued = true;
          this.workflow.examFeedback.set('Finalização registrada — aguardando sincronização dos resultados.');
          this.qualityControlService.watchFinalizationDelivery(finishCommandId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(update => {
              if (update.deliveryStatus === 'PENDING') return;
              if (update.deliveryStatus === 'SYNCED' && update.finalizado === true) {
                const detail = update.mensagem?.trim();
                this.workflow.examFeedback.set(detail || 'Ficha finalizada e confirmada pelo Datasul.');
                return;
              }
              this.workflow.examFeedback.set(
                update.mensagem?.trim()
                  || 'A finalização não foi confirmada pelo Datasul. Consulte a Central de Sincronização.',
              );
            });
        },
        error: () => {
          this.workflow.isFinishing.set(false);
          this.workflow.examFeedback.set('Nao foi possivel concluir o exame. Tente novamente.');
        },
      });
  }

  stopRoute(): void {
    const route = this.workflow.route();
    const exam = this.exam;
    if (!route || !exam || !this.canStopRoute) return;

    const reason = this.stopReason.trim();
    if (!reason) {
      this.stopValidationMessage = 'Informe o motivo da parada do roteiro.';
      return;
    }

    this.stopValidationMessage = '';
    this.workflow.isStopping.set(true);
    this.workflow.examFeedback.set('Parando roteiro...');
    const measurementCommandIds = this.workflow.measurementCommandIds(exam.id);
    let stopCommandId: string;
    let inspectionCommandId: string;
    try {
      stopCommandId = this.workflow.ensureStopCommandId(() => this.idempotency.resolve());
      inspectionCommandId = this.workflow.ensureInspectionCommandId(
        exam.id,
        () => this.idempotency.resolve(),
      );
    } catch {
      this.workflow.isStopping.set(false);
      this.workflow.examFeedback.set('Não foi possível gerar a identidade segura da parada.');
      return;
    }
    this.qualityControlService.stopInspectionRoute({
      routeNumber: route.routeNumber,
      ...(route.localId || route.creationCommandId
        ? { routeLocalId: route.localId ?? route.creationCommandId }
        : {}),
      examId: exam.id,
      reason,
      idempotencyKey: stopCommandId,
      dependencyIds: [
        ...(route.creationCommandId ? [route.creationCommandId] : []),
        ...measurementCommandIds,
      ],
    })
      .pipe(
        concatMap(() => this.captureInspection(
          this.inspectionPayload(exam, route, inspectionCommandId, [stopCommandId]),
        )),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.workflow.completeRouteStop();
          this.panelClosed.emit();
        },
        error: () => {
          this.workflow.isStopping.set(false);
          this.workflow.examFeedback.set('Nao foi possivel parar o roteiro. Tente novamente.');
        },
      });
  }

  private clearValidation(): void {
    this.validationMessage = '';
    this.validationIsOutOfRange = false;
  }

  private inspectionPayload(
    exam: NonNullable<ExamEntryPanel['exam']>,
    route: NonNullable<ReturnType<QualityControlWorkflowState['route']>>,
    idempotencyKey: string,
    dependencyIds: readonly string[],
  ) {
    const measurements = exam.components.flatMap(component => {
      const measurement = component.measurement;
      if (!measurement) return [];
      return [{
        componentId: component.id,
        componentCode: component.code,
        description: component.description,
        measuredValue: measurement.result,
        ...(measurement.report ? { report: measurement.report } : {}),
        expectedMin: component.minValue,
        expectedMax: component.maxValue,
        unit: component.unit,
        status: measurement.withinRange === false ? 'REJECTED' as const : 'APPROVED' as const,
        ...(measurement.observation ? { observation: measurement.observation } : {}),
      }];
    });
    return {
      opNumber: route.currentOrder,
      operationCode: route.operationCode,
      split: route.split,
      routeNumber: route.routeNumber,
      itemCode: route.itemCode,
      itemDescription: route.itemDescription,
      examId: exam.id,
      examCode: exam.code,
      examVersion: exam.version,
      operatorId: this.operatorService.selectedOperator?.code ?? '',
      status: measurements.some(measurement => measurement.status === 'REJECTED')
        ? 'REJECTED' as const
        : 'APPROVED' as const,
      createdAt: new Date(),
      measurements,
      idempotencyKey,
      dependencyIds,
    };
  }

  private captureInspection(
    payload: Parameters<QualityControlService['saveInspection']>[0],
  ) {
    return typeof this.qualityControlService.saveInspection === 'function'
      ? this.qualityControlService.saveInspection(payload)
      : of({
          inspectionId: payload.idempotencyKey ?? '',
          savedAt: new Date(),
          idempotencyKey: payload.idempotencyKey ?? '',
          syncStatus: 'PENDING' as const,
        });
  }
  private parseNumber(value: string): number | null {
    if (!value.trim()) return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  private sanitizeNumericInput(value: string): string {
    let result = '';
    let hasSeparator = false;
    for (const char of value) {
      if (/\d/.test(char)) result += char;
      else if (char === '-' && result.length === 0) result = '-';
      else if ((char === ',' || char === '.') && !hasSeparator) { result += char; hasSeparator = true; }
    }
    return result;
  }

  private hasSupportedPrecision(value: string, decimalPlaces: number): boolean {
    const separatorIndex = Math.max(value.lastIndexOf(','), value.lastIndexOf('.'));
    return separatorIndex < 0 || value.length - separatorIndex - 1 <= decimalPlaces;
  }
}
