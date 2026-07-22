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
import { catchError, Observable, of, tap } from 'rxjs';

import { PoButtonModule, PoDialogService, PoFieldModule, PoIconModule, PoProgressModule, PoWidgetModule } from '@po-ui/ng-components';

import { SaveMeasurementResponse } from '../../models/inspection-record';
import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';
import { OperatorService } from '../../../shop-floor/services/operator';

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

  validationMessage = '';
  alertTitle = '';

  ngAfterViewInit(): void {
    this.panelTitle?.nativeElement.focus();
  }

  get exam() { return this.workflow.selectedExam(); }
  get currentCharacteristic() { return this.workflow.selectedComponent(); }
  get characteristics() { return this.exam?.components ?? []; }
  get currentIndex(): number {
    return this.characteristics.findIndex(component => component.id === this.currentCharacteristic?.id);
  }
  get minimum(): string { return this.currentCharacteristic ? this.workflow.draftFor(this.currentCharacteristic.id).minimum : ''; }
  get maximum(): string { return this.currentCharacteristic ? this.workflow.draftFor(this.currentCharacteristic.id).maximum : ''; }
  get observation(): string { return this.currentCharacteristic ? this.workflow.draftFor(this.currentCharacteristic.id).observation : ''; }
  set observation(value: string) { if (this.currentCharacteristic) this.workflow.updateDraft(this.currentCharacteristic.id, { observation: value }); }
  get progressText(): string { return this.characteristics.length ? `${this.currentIndex + 1} / ${this.characteristics.length}` : '0 / 0'; }
  get completedCount(): number { return this.characteristics.filter(item => item.measurement?.status === 'APPROVED').length; }
  get progressPercentage(): number { return this.characteristics.length ? Math.round((this.completedCount / this.characteristics.length) * 100) : 0; }
  get canGoPrevious(): boolean { return this.currentIndex > 0 && !this.workflow.isSaving(); }
  get canGoNext(): boolean { return this.currentIndex >= 0 && this.currentIndex < this.characteristics.length - 1 && !this.workflow.isSaving(); }
  get canCompleteExam(): boolean { return this.characteristics.length > 0 && this.completedCount === this.characteristics.length && !this.workflow.isBusy(); }
  get currentMeasurementReference(): string {
    return this.currentCharacteristic
      ? `${this.currentCharacteristic.reference} ${this.currentCharacteristic.unit}`.trim()
      : '-';
  }

  updateMinimum(value: string): void {
    if (this.currentCharacteristic) {
      this.workflow.clearComponentOutOfRange(this.currentCharacteristic.id);
      this.workflow.updateDraft(this.currentCharacteristic.id, { minimum: this.sanitizeNumericInput(value) });
    }
  }

  updateMaximum(value: string): void {
    if (this.currentCharacteristic) {
      this.workflow.clearComponentOutOfRange(this.currentCharacteristic.id);
      this.workflow.updateDraft(this.currentCharacteristic.id, { maximum: this.sanitizeNumericInput(value) });
    }
  }

  saveCurrentMeasurement(): Observable<SaveMeasurementResponse | null> {
    const exam = this.exam;
    const characteristic = this.currentCharacteristic;
    if (!exam || !characteristic || this.workflow.isSaving()) return of(null);
    this.clearValidation();
    const draft = this.workflow.draftFor(characteristic.id);
    const minimum = this.parseNumber(draft.minimum);
    const maximum = this.parseNumber(draft.maximum);
    if (minimum === null || maximum === null) {
      this.validationMessage = 'Informe valores numéricos para Min e Max.';
      return of(null);
    }

    const validation = this.qualityControlService.validateMeasurementRange(characteristic, { minimum, maximum });
    if (validation.valid === false) {
      this.validationMessage = validation.message;
      if (validation.reason === 'OUT_OF_RANGE') {
        this.alertTitle = 'Alerta';
        this.workflow.markComponentOutOfRange(characteristic.id);
      } else {
        this.workflow.clearComponentOutOfRange(characteristic.id);
      }
      return of(null);
    }

    this.workflow.isSaving.set(true);
    this.workflow.examFeedback.set('Salvando medição...');
    return this.qualityControlService.saveMeasurement({
      examId: exam.id,
      componentId: characteristic.id,
      measurement: {
        minimum,
        maximum,
        observation: draft.observation.trim() || undefined,
        status: validation.status,
      },
      operatorId: this.operatorService.selectedOperator?.code ?? '',
    }).pipe(
      tap(response => {
        this.workflow.applyMeasurement(exam.id, characteristic.id, response.measurement);
        this.workflow.isSaving.set(false);
        this.workflow.examFeedback.set('Medição salva.');
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
    if (!exam || !this.canCompleteExam) return;
    this.workflow.isFinishing.set(true);
    this.workflow.examFeedback.set('Concluindo exame...');
    this.qualityControlService.finishExam({ examId: exam.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.workflow.isFinishing.set(false);
          this.workflow.examFeedback.set('Exame concluído.');
          const nextComponentId = this.workflow.selectNextPendingAndClose();
          this.panelClosed.emit(nextComponentId);
        },
        error: () => {
          this.workflow.isFinishing.set(false);
          this.workflow.examFeedback.set('Nao foi possivel concluir o exame. Tente novamente.');
        },
      });
  }

  private clearValidation(): void { this.validationMessage = ''; this.alertTitle = ''; }
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
      else if ((char === ',' || char === '.') && !hasSeparator) { result += char; hasSeparator = true; }
    }
    return result;
  }
}
