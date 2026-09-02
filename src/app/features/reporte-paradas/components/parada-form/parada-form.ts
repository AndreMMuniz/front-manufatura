import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  PoButtonModule,
  PoFieldModule,
  PoSelectOption,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { StopReason } from '../../models/reporte-paradas.model';
import {
  FinalizacaoDraft,
  ParadaDraft,
} from '../../services/reporte-paradas-workflow-state';

type ParadaFormControls = {
  reasonId: FormControl<number | null>;
  startDate: FormControl<Date | string | null>;
  startTime: FormControl<string>;
  endDate: FormControl<Date | string | null>;
  endTime: FormControl<string>;
};

@Component({
  selector: 'app-parada-form',
  imports: [ReactiveFormsModule, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './parada-form.html',
  styleUrls: ['./parada-form.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParadaForm implements OnChanges {
  private readonly destroyRef = inject(DestroyRef);
  private syncingInput = false;

  @Input() reasons: ReadonlyArray<StopReason> = [];
  @Input() draft: ParadaDraft = this.emptyDraft();
  @Input() disabled = false;
  @Input() loading = false;
  @Input() finishLoading = false;
  @Input() externalError = '';

  @Output() draftChange = new EventEmitter<ParadaDraft>();
  @Output() confirm = new EventEmitter<ParadaDraft>();
  @Output() finish = new EventEmitter<FinalizacaoDraft>();

  finishAttempted = false;

  readonly form = new FormGroup<ParadaFormControls>({
    reasonId: new FormControl<number | null>(null, Validators.required),
    startDate: new FormControl<Date | string | null>(null, Validators.required),
    startTime: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)],
    }),
    endDate: new FormControl<Date | string | null>(null),
    endTime: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^$|^([01]\d|2[0-3]):[0-5]\d$/)],
    }),
  }, { validators: [this.endPairValidator] });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.syncingInput) {
          this.draftChange.emit(this.form.getRawValue());
        }
      });
  }

  get reasonOptions(): ReadonlyArray<PoSelectOption> {
    return this.reasons.map(reason => ({
      value: reason.id,
      label: `${reason.code} - ${reason.description}`,
    }));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['draft']) {
      this.syncingInput = true;
      this.form.patchValue(this.draft, { emitEvent: false });
      this.syncingInput = false;
    }
    if (this.disabled || this.loading || this.finishLoading) {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.form.disabled) {
      return;
    }
    this.confirm.emit(this.form.getRawValue());
  }

  submitFinish(): void {
    this.finishAttempted = true;
    const endDate = this.form.controls.endDate;
    const endTime = this.form.controls.endTime;
    endDate.markAsTouched();
    endTime.markAsTouched();
    const rawEndDate = endDate.value;
    const hasEndDate = rawEndDate instanceof Date
      || (typeof rawEndDate === 'string' && rawEndDate.trim().length > 0);
    const rawEndTime = endTime.value.trim();
    if (!hasEndDate) {
      endDate.setErrors({ ...endDate.errors, required: true });
    }
    if (!rawEndTime) {
      endTime.setErrors({ ...endTime.errors, required: true });
    }
    if (!hasEndDate || !rawEndTime || endDate.invalid || endTime.invalid || this.form.disabled) {
      return;
    }
    this.finish.emit({ endDate: rawEndDate!, endTime: rawEndTime });
  }

  private endPairValidator(control: AbstractControl): ValidationErrors | null {
    const endDate = control.get('endDate')?.value;
    const endTime = String(control.get('endTime')?.value ?? '').trim();
    const hasEndDate = endDate instanceof Date
      || (typeof endDate === 'string' && endDate.trim().length > 0);
    return hasEndDate === Boolean(endTime) ? null : { endPair: true };
  }

  private emptyDraft(): ParadaDraft {
    return {
      reasonId: null,
      startDate: null,
      startTime: '',
      endDate: null,
      endTime: '',
    };
  }
}
