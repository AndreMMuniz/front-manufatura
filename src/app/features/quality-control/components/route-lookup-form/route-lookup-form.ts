import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-route-lookup-form',
  imports: [FormsModule, PoButtonModule, PoFieldModule],
  templateUrl: './route-lookup-form.html',
  styleUrls: ['./route-lookup-form.css'],
})
export class RouteLookupForm {
  @Input() opNumber = '';
  @Input() operationCode = '';
  @Input() split = '';
  @Input() canGenerateRoute = false;

  @Output() opNumberChange = new EventEmitter<string>();
  @Output() operationCodeChange = new EventEmitter<string>();
  @Output() splitChange = new EventEmitter<string>();
  @Output() routeGenerated = new EventEmitter<void>();
}
