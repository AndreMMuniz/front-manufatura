import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { PoButtonModule, PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { StopEntry } from '../../models/reporte-paradas.model';
import { combineLocalDateTime } from '../../models/reporte-paradas-time';
import { FinalizacaoDraft } from '../../services/reporte-paradas-workflow-state';

type FinalizarParadaControls = {
  endDate: FormControl<Date | string | null>;
  endTime: FormControl<string>;
};

@Component({
  selector: 'app-finalizar-parada-form',
  imports: [DatePipe, ReactiveFormsModule, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './finalizar-parada-form.html',
  styleUrls: ['./finalizar-parada-form.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinalizarParadaForm implements OnChanges {
  private readonly destroyRef = inject(DestroyRef);
  private syncingInput = false;
  private destroyed = false;

  @Input({ required: true }) stop!: StopEntry;
  @Input() draft: FinalizacaoDraft = { endDate: null, endTime: '' };
  @Input() loading = false;
  @Input() disabled = false;
  @Input() externalError = '';

  @Output() draftChange = new EventEmitter<FinalizacaoDraft>();
  @Output() confirm = new EventEmitter<FinalizacaoDraft>();

  @ViewChild('endDateField', { read: ElementRef }) private endDateField?: ElementRef<HTMLElement>;

  readonly form = new FormGroup<FinalizarParadaControls>({
    endDate: new FormControl<Date | string | null>(null, Validators.required),
    endTime: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)],
    }),
  }, { validators: control => this.intervalValidator(control) });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.syncingInput) {
          this.draftChange.emit(this.form.getRawValue());
        }
      });
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.syncingInput = true;
    this.form.patchValue(this.draft, { emitEvent: false });
    this.syncingInput = false;
    if (this.loading || this.disabled) {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.form.disabled) {
      return;
    }
    this.confirm.emit(this.form.getRawValue());
  }

  focusFirstField(remainingAttempts = 4): void {
    const input = this.endDateField?.nativeElement.querySelector('input');
    const target = input ?? this.endDateField?.nativeElement;
    target?.focus();
    if (target && remainingAttempts > 1) {
      setTimeout(() => {
        if (!this.destroyed && target.ownerDocument.activeElement !== target) {
          this.focusFirstField(remainingAttempts - 1);
        }
      }, 50);
    }
  }

  responsibleType(): string {
    return this.stop.responsible.tipo === 'OPERADOR' ? 'Operador' : 'Equipe';
  }

  private intervalValidator(control: AbstractControl): ValidationErrors | null {
    if (!this.stop) {
      return null;
    }
    const endDate = control.get('endDate')?.value;
    const endTime = String(control.get('endTime')?.value ?? '');
    if (!endDate || !endTime || control.get('endTime')?.hasError('pattern')) {
      return null;
    }
    const start = combineLocalDateTime(this.stop.startDate, this.stop.startTime);
    const end = combineLocalDateTime(endDate, endTime);
    return start && end && end.getTime() >= start.getTime() ? null : { interval: true };
  }
}
