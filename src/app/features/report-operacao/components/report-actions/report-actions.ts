import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { PoButtonModule, PoWidgetModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-report-actions',
  imports: [PoButtonModule, PoWidgetModule],
  templateUrl: './report-actions.html',
  styleUrls: ['./report-actions.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportActions {
  @Input() iniciarDisabled = true;
  @Input() iniciarLoading = false;
  @Input() reporteDisabled = true;
  @Input() reporteLoading = false;

  @Output() iniciar = new EventEmitter<void>();
  @Output() reporte = new EventEmitter<void>();
}
