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

  get cameraScannerAvailable(): boolean {
    return typeof globalThis.matchMedia === 'function'
      && globalThis.matchMedia('(hover: none) and (pointer: coarse)').matches
      && typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function';
  }
}
