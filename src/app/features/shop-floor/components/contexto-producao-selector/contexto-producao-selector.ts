import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PoButtonModule,
  PoFieldModule,
  PoLoadingModule,
  PoSelectOption,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { AreaProducao } from '../../models/production-area';
import { WorkCenter } from '../../models/work-center';

@Component({
  selector: 'app-contexto-producao-selector',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoLoadingModule, PoWidgetModule],
  templateUrl: './contexto-producao-selector.html',
  styleUrls: ['./contexto-producao-selector.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextoProducaoSelector {
  @Input() areas: ReadonlyArray<AreaProducao> = [];
  @Input() centers: ReadonlyArray<WorkCenter> = [];
  @Input() areaCode = '';
  @Input() workCenterCode = '';
  @Input() loadingAreas = false;
  @Input() loadingCenters = false;
  @Input() loadingAction = false;
  @Input() disabled = false;
  @Input() consultBlocked = false;
  @Input() showAction = true;
  @Input() actionLabel = 'Consultar ordens';
  @Input() loadingText = 'Consultando ordens...';
  @Input() errorMessage = '';

  @Output() areaChange = new EventEmitter<string>();
  @Output() workCenterChange = new EventEmitter<string>();
  @Output() action = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();

  get areaOptions(): ReadonlyArray<PoSelectOption> {
    return this.areas.map(area => ({
      value: area.code,
      label: `${area.code} - ${area.description}`,
    }));
  }

  get centerOptions(): ReadonlyArray<PoSelectOption> {
    return this.centers.map(center => ({
      value: center.code,
      label: `${center.code} - ${center.description}`,
    }));
  }

  get centerDisabled(): boolean {
    return this.disabled || this.loadingAreas || this.loadingCenters || !this.areaCode;
  }

  get actionDisabled(): boolean {
    return this.disabled
      || this.consultBlocked
      || this.loadingAreas
      || this.loadingCenters
      || this.loadingAction
      || !this.areaCode
      || !this.workCenterCode;
  }

  changeArea(value: string | null | undefined): void {
    this.areaChange.emit(value ?? '');
  }

  changeWorkCenter(value: string | null | undefined): void {
    this.workCenterChange.emit(value ?? '');
  }
}
