import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PoButtonModule,
  PoFieldModule,
  PoLoadingModule,
  PoSelectOption,
  PoWidgetModule,
} from '@po-ui/ng-components';

import { WorkCenter } from '../../../shop-floor/models/work-center';
import { AreaProducaoBatelada } from '../../models/reporta-batelada.model';

@Component({
  selector: 'app-contexto-producao-batelada',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoLoadingModule, PoWidgetModule],
  templateUrl: './contexto-producao.html',
  styleUrls: ['./contexto-producao.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextoProducaoBatelada {
  @Input() areas: ReadonlyArray<AreaProducaoBatelada> = [];
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

  get consultDisabled(): boolean {
    return (
      this.disabled ||
      this.loadingAreas ||
      this.loadingCenters ||
      this.loadingOrders ||
      !this.areaCode ||
      !this.workCenterCode
    );
  }
}
