import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoLoadingModule, PoSelectOption, PoWidgetModule } from '@po-ui/ng-components';

import { WorkCenter } from '../../../shop-floor/models/work-center';
import { AreaProducao } from '../../models/report-operacao.model';

@Component({
  selector: 'app-contexto-producao-card',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoLoadingModule, PoWidgetModule],
  templateUrl: './contexto-producao-card.html',
  styleUrls: ['./contexto-producao-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextoProducaoCard {
  @Input() areas: ReadonlyArray<AreaProducao> = [];
  @Input() centers: ReadonlyArray<WorkCenter> = [];
  @Input() areaCode = '';
  @Input() workCenterCode = '';
  @Input() loadingAreas = false;
  @Input() loadingCenters = false;
  @Input() loadingOrders = false;
  @Input() disabled = false;
  @Input() errorMessage = '';

  @Output() areaChange = new EventEmitter<string>();
  @Output() workCenterChange = new EventEmitter<string>();
  @Output() consult = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();

  get areaOptions(): ReadonlyArray<PoSelectOption> {
    return this.areas.map(area => ({ value: area.code, label: `${area.code} - ${area.description}` }));
  }

  get centerOptions(): ReadonlyArray<PoSelectOption> {
    return this.centers.map(center => ({ value: center.code, label: `${center.code} - ${center.description}` }));
  }

  get centerDisabled(): boolean {
    return this.disabled || this.loadingAreas || !this.areaCode;
  }

  get consultDisabled(): boolean {
    return this.disabled || this.loadingAreas || this.loadingCenters || this.loadingOrders
      || !this.areaCode || !this.workCenterCode;
  }

  changeArea(value: string): void {
    this.areaCode = value ?? '';
    this.workCenterCode = '';
    this.areaChange.emit(this.areaCode);
  }

  changeWorkCenter(value: string): void {
    this.workCenterCode = value ?? '';
    this.workCenterChange.emit(this.workCenterCode);
  }
}
