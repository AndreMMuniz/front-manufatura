import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  InjectionToken,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { PoButtonModule } from '@po-ui/ng-components';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';

type BarcodeReader = Pick<BrowserMultiFormatReader, 'decodeFromConstraints'>;

export const BARCODE_READER_FACTORY = new InjectionToken<() => BarcodeReader>('BARCODE_READER_FACTORY', {
  providedIn: 'root',
  factory: () => () => new BrowserMultiFormatReader(),
});

@Component({
  selector: 'app-barcode-scanner',
  imports: [PoButtonModule],
  templateUrl: './barcode-scanner.html',
  styleUrls: ['./barcode-scanner.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarcodeScanner implements AfterViewInit, OnDestroy {
  @Output() scanCompleted = new EventEmitter<string>();
  @Output() scanCancelled = new EventEmitter<void>();
  @Output() scanFailed = new EventEmitter<string>();

  @ViewChild('preview', { static: true }) private readonly preview!: ElementRef<HTMLVideoElement>;

  private readonly reader = inject(BARCODE_READER_FACTORY)();
  private controls?: IScannerControls;
  private finished = false;

  ngAfterViewInit(): void {
    void this.reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: 'environment' } } },
      this.preview.nativeElement,
      (result, _error, controls) => {
        if (!result || this.finished) return;
        this.finished = true;
        controls.stop();
        this.scanCompleted.emit(result.getText());
      },
    ).then(controls => {
      this.controls = controls;
      if (this.finished) controls.stop();
    }).catch(() => {
      if (this.finished) return;
      this.finished = true;
      this.scanFailed.emit(
        'Não foi possível acessar a câmera. Autorize o uso da câmera e tente novamente.',
      );
    });
  }

  ngOnDestroy(): void {
    this.finished = true;
    this.controls?.stop();
  }
}
