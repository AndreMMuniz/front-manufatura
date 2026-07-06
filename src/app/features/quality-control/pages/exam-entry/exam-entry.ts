import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, Observable, of, tap } from 'rxjs';

import {
  PoButtonModule,
  PoFieldModule,
  PoPageModule,
  PoProgressModule,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityExam, QualityExamComponent } from '../../models/quality-exam';
import { SaveMeasurementResponse } from '../../models/inspection-record';
import { QualityControlService } from '../../services/quality-control';
import { OperatorService } from '../../../shop-floor/services/operator';

interface MeasurementDraft {
  minimum: string;
  maximum: string;
  observation: string;
}

@Component({
  selector: 'app-exam-entry',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoProgressModule, PoWidgetModule],
  templateUrl: './exam-entry.html',
  styleUrls: ['./exam-entry.css'],
})
export class ExamEntryPage {
  productionOrderRoute?: ProductionOrderRoute;
  exam?: QualityExam;
  qualityExams: QualityExam[] = [];
  characteristics: QualityExamComponent[] = [];
  currentIndex = 0;
  minimum = '';
  maximum = '';
  observation = '';
  feedback = '';
  validationMessage = '';
  errorTitle = '';
  isSaving = false;

  private readonly drafts = new Map<string, MeasurementDraft>();

  constructor(
    private readonly qualityControlService: QualityControlService,
    private readonly router?: Router,
    private readonly operatorService?: OperatorService,
  ) {
    this.loadContextFromNavigation();
  }

  get currentCharacteristic(): QualityExamComponent | undefined {
    return this.characteristics[this.currentIndex];
  }

  get progressText(): string {
    if (this.characteristics.length === 0) {
      return '0 / 0';
    }

    return `${this.currentIndex + 1} / ${this.characteristics.length}`;
  }

  get progressPercentage(): number {
    if (this.characteristics.length === 0) {
      return 0;
    }

    return Math.round((this.completedCount / this.characteristics.length) * 100);
  }

  get completedCount(): number {
    return this.characteristics.filter(characteristic => characteristic.measurement?.status === 'APPROVED').length;
  }

  get canGoPrevious(): boolean {
    return this.currentIndex > 0 && !this.isSaving;
  }

  get canGoNext(): boolean {
    return this.currentIndex < this.characteristics.length - 1 && !this.isSaving;
  }

  get canCompleteExam(): boolean {
    return this.characteristics.length > 0 && this.completedCount === this.characteristics.length && !this.isSaving;
  }

  get hasUnsavedChanges(): boolean {
    const characteristic = this.currentCharacteristic;

    if (!characteristic) {
      return false;
    }

    const savedMinimum = characteristic.measurement?.minimum?.toString() ?? '';
    const savedMaximum = characteristic.measurement?.maximum?.toString() ?? '';
    const savedObservation = characteristic.measurement?.observation ?? '';

    return (
      this.minimum !== savedMinimum ||
      this.maximum !== savedMaximum ||
      this.observation !== savedObservation
    );
  }

  get currentMeasurementReference(): string {
    const characteristic = this.currentCharacteristic;

    if (!characteristic) {
      return '-';
    }

    return `${characteristic.reference} ${characteristic.unit}`.trim();
  }

  saveCurrentMeasurement(): Observable<SaveMeasurementResponse | null> {
    const characteristic = this.currentCharacteristic;

    if (!this.exam || !characteristic) {
      return of(null);
    }

    this.persistDraft(characteristic);
    this.clearValidation();

    const parsedMinimum = this.parseNumber(this.minimum);
    const parsedMaximum = this.parseNumber(this.maximum);

    if (parsedMinimum === null || parsedMaximum === null) {
      this.validationMessage = 'Informe valores numéricos para Min e Max.';
      return of(null);
    }

    const validation = this.qualityControlService.validateMeasurementRange(characteristic, {
      minimum: parsedMinimum,
      maximum: parsedMaximum,
    });

    if (validation.valid === false) {
      this.validationMessage = validation.message;

      if (validation.reason === 'OUT_OF_RANGE') {
        this.errorTitle = 'Erro';
      }

      return of(null);
    }

    this.isSaving = true;
    this.feedback = 'Salvando medição...';

    return this.qualityControlService
      .saveMeasurement({
        examId: this.exam.id,
        componentId: characteristic.id,
        measurement: {
          minimum: parsedMinimum,
          maximum: parsedMaximum,
          observation: this.observation.trim() || undefined,
          status: validation.status,
        },
        operatorId: this.operatorId,
      })
      .pipe(
        tap(response => {
          characteristic.measurement = response.measurement;
          characteristic.status = response.measurement.status;
          characteristic.inspectedAt = response.measurement.savedAt;
          characteristic.operatorId = response.measurement.operatorId;
          this.isSaving = false;
          this.feedback = 'Medição salva.';
          this.loadFieldsFromCurrentCharacteristic();
        }),
        catchError(error => {
          this.isSaving = false;
          this.feedback = 'Nao foi possivel salvar a medição. Tente novamente.';
          return of(null);
        }),
      );
  }

  updateMinimum(value: string): void {
    this.minimum = this.sanitizeNumericInput(value);
  }

  updateMaximum(value: string): void {
    this.maximum = this.sanitizeNumericInput(value);
  }

  goPrevious(): void {
    if (!this.canGoPrevious || !this.currentCharacteristic) {
      return;
    }

    this.persistDraft(this.currentCharacteristic);
    this.currentIndex -= 1;
    this.loadFieldsFromCurrentCharacteristic();
  }

  goNext(): void {
    if (!this.canGoNext || !this.currentCharacteristic) {
      return;
    }

    this.persistDraft(this.currentCharacteristic);
    this.currentIndex += 1;
    this.loadFieldsFromCurrentCharacteristic();
  }

  goBack(): void {
    if (this.canLeaveCurrentMeasurement()) {
      void this.router?.navigate(['/quality-control/inspection'], {
        state: {
          productionOrderRoute: this.productionOrderRoute,
          qualityExams: this.qualityExams,
        },
      });
    }
  }

  exit(): void {
    if (this.canLeaveCurrentMeasurement()) {
      void this.router?.navigate(['/quality-control']);
    }
  }

  completeExam(): void {
    if (!this.exam || !this.canCompleteExam) {
      return;
    }

    this.qualityControlService.finishExam({ examId: this.exam.id }).subscribe({
      next: () => {
        this.feedback = 'Exame concluído.';
      },
      error: () => {
        this.feedback = 'Nao foi possivel concluir o exame. Tente novamente.';
      },
    });
  }

  private loadContextFromNavigation(): void {
    const state = this.router?.getCurrentNavigation()?.extras.state;
    const route = state?.['productionOrderRoute'] as ProductionOrderRoute | undefined;
    const exam = state?.['exam'] as QualityExam | undefined;
    const qualityExams = state?.['qualityExams'] as QualityExam[] | undefined;
    const componentId = state?.['componentId'] as string | undefined;

    if (!route || !exam) {
      this.feedback = 'Selecione um exame antes de iniciar a digitação.';
      void this.router?.navigate(['/quality-control']);
      return;
    }

    this.productionOrderRoute = route;
    this.qualityExams = qualityExams?.length
      ? this.orderExams(qualityExams)
      : this.orderExams([exam]);
    this.exam = this.qualityExams.find(item => item.id === exam.id) ?? {
      ...exam,
      components: [...exam.components].sort((a, b) => a.sequence - b.sequence),
    };
    this.characteristics = this.exam.components;
    this.currentIndex = Math.max(
      0,
      componentId ? this.characteristics.findIndex(characteristic => characteristic.id === componentId) : 0,
    );
    this.loadFieldsFromCurrentCharacteristic();
  }

  private loadFieldsFromCurrentCharacteristic(): void {
    this.clearValidation();
    const characteristic = this.currentCharacteristic;

    if (!characteristic) {
      this.minimum = '';
      this.maximum = '';
      this.observation = '';
      return;
    }

    const draft = this.drafts.get(characteristic.id);

    if (draft) {
      this.minimum = draft.minimum;
      this.maximum = draft.maximum;
      this.observation = draft.observation;
      return;
    }

    this.minimum = characteristic.measurement?.minimum?.toString() ?? '';
    this.maximum = characteristic.measurement?.maximum?.toString() ?? '';
    this.observation = characteristic.measurement?.observation ?? '';
  }

  private persistDraft(characteristic: QualityExamComponent): void {
    this.drafts.set(characteristic.id, {
      minimum: this.minimum,
      maximum: this.maximum,
      observation: this.observation,
    });
  }

  private clearValidation(): void {
    this.validationMessage = '';
    this.errorTitle = '';
  }

  private canLeaveCurrentMeasurement(): boolean {
    if (this.isSaving) {
      return false;
    }

    if (this.hasUnsavedChanges) {
      this.feedback = 'Salve a medição atual antes de sair.';
      return false;
    }

    return true;
  }

  private parseNumber(value: string): number | null {
    if (!value.trim()) {
      return null;
    }

    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private get operatorId(): string {
    return this.operatorService?.selectedOperator?.code ?? '';
  }

  private sanitizeNumericInput(value: string): string {
    let result = '';
    let hasSeparator = false;

    for (const char of value) {
      if (/\d/.test(char)) {
        result += char;
        continue;
      }

      if ((char === ',' || char === '.') && !hasSeparator) {
        result += char;
        hasSeparator = true;
      }
    }

    return result;
  }

  private orderExams(exams: QualityExam[]): QualityExam[] {
    return exams.map(exam => ({
      ...exam,
      components: [...exam.components].sort((a, b) => a.sequence - b.sequence),
    }));
  }
}
