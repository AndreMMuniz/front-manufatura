import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';
import { PoButtonModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-barcode-scanner',
  imports: [PoButtonModule],
  templateUrl: './barcode-scanner.html',
  styleUrls: ['./barcode-scanner.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarcodeScanner {
  @Output() scanCompleted = new EventEmitter<string>();
  @Output() scanCancelled = new EventEmitter<void>();
  @Output() scanFailed = new EventEmitter<string>();
}
