import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule } from '@po-ui/ng-components';

import { QualityExamComponent } from '../../models/quality-exam';

@Component({
  selector: 'app-measurement-entry-form',
  imports: [FormsModule, PoButtonModule, PoFieldModule],
  templateUrl: './measurement-entry-form.html',
  styleUrls: ['./measurement-entry-form.css'],
})
export class MeasurementEntryForm {
  @Input({ required: true }) component!: QualityExamComponent;
  @Input() measuredValue = '';
  @Input() observation = '';
  @Input() feedback = '';

  @Output() measuredValueChange = new EventEmitter<string>();
  @Output() observationChange = new EventEmitter<string>();
  @Output() measurementSaved = new EventEmitter<void>();

  updateMeasuredValue(value: string): void {
    this.measuredValueChange.emit(value);
  }

  updateObservation(value: string): void {
    this.observationChange.emit(value);
  }

  saveMeasurement(): void {
    this.measurementSaved.emit();
  }
}
