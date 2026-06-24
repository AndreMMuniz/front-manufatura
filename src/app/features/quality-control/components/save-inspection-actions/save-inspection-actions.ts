import { Component, EventEmitter, Input, Output } from '@angular/core';

import { PoButtonModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-save-inspection-actions',
  imports: [PoButtonModule],
  templateUrl: './save-inspection-actions.html',
  styleUrls: ['./save-inspection-actions.css'],
})
export class SaveInspectionActions {
  @Input() canSaveInspection = false;
  @Input() blockReason = '';
  @Input() saveFeedback = '';

  @Output() inspectionSaved = new EventEmitter<void>();
}
