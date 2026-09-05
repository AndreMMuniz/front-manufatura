import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { Result } from '@zxing/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BarcodeScanner } from './barcode-scanner';

describe('BarcodeScanner', () => {
  let fixture: ComponentFixture<BarcodeScanner>;
  let callback: Parameters<BrowserMultiFormatReader['decodeFromConstraints']>[2];
  const controls: IScannerControls = { stop: vi.fn() };
  const decode = vi.spyOn(BrowserMultiFormatReader.prototype, 'decodeFromConstraints');

  beforeEach(async () => {
    vi.clearAllMocks();
    decode.mockImplementation(async (_deviceId, _preview, receivedCallback) => {
      callback = receivedCallback;
      return controls;
    });
    await TestBed.configureTestingModule({ imports: [BarcodeScanner] }).compileComponents();
    fixture = TestBed.createComponent(BarcodeScanner);
  });

  it('usa a câmera traseira e entrega o primeiro código reconhecido', async () => {
    const completed = vi.fn();
    fixture.componentInstance.scanCompleted.subscribe(completed);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(decode).toHaveBeenCalledWith(
      { audio: false, video: { facingMode: { ideal: 'environment' } } },
      fixture.debugElement.query(By.css('video')).nativeElement,
      expect.any(Function),
    );

    callback({ getText: () => '372562' } as Result, undefined, controls);

    expect(completed).toHaveBeenCalledWith('372562');
    expect(controls.stop).toHaveBeenCalledTimes(1);
  });

  it('informa quando o usuário não autoriza o acesso à câmera', async () => {
    decode.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
    const failed = vi.fn();
    fixture.componentInstance.scanFailed.subscribe(failed);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(failed).toHaveBeenCalledWith(
      'Não foi possível acessar a câmera. Autorize o uso da câmera e tente novamente.',
    );
  });
});
