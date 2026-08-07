import { Component, EventEmitter, Input, Output } from '@angular/core';

import { PoButtonModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-scanner-button',
  imports: [PoButtonModule],
  templateUrl: './scanner-button.html',
  styleUrls: ['./scanner-button.css'],
})
export class ScannerButton {
  @Input() disabled = false;

  @Output() scannerStarted = new EventEmitter<void>();
}
