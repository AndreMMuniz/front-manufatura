import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-reaction-plan-authorization-form',
  imports: [FormsModule, PoButtonModule, PoFieldModule],
  templateUrl: './reaction-plan-authorization-form.html',
  styleUrls: ['./reaction-plan-authorization-form.css'],
})
export class ReactionPlanAuthorizationForm {
  @Input() supervisorId = '';
  @Input() supervisorPassword = '';
  @Input() authorizationReason = '';
  @Input() canAuthorize = false;

  @Output() supervisorIdChange = new EventEmitter<string>();
  @Output() supervisorPasswordChange = new EventEmitter<string>();
  @Output() authorizationReasonChange = new EventEmitter<string>();
  @Output() reactionPlanAuthorized = new EventEmitter<void>();

  authorize(): void {
    this.reactionPlanAuthorized.emit();
  }
}
