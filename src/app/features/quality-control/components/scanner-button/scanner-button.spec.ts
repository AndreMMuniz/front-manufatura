import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScannerButton } from './scanner-button';

describe('ScannerButton', () => {
  let fixture: ComponentFixture<ScannerButton>;
  const originalMatchMedia = globalThis.matchMedia;
  const originalMediaDevices = globalThis.navigator.mediaDevices;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ScannerButton] }).compileComponents();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: originalMatchMedia });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it('oculta o acionamento da câmera em dispositivos desktop', () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });

    fixture = TestBed.createComponent(ScannerButton);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('po-button'))).toBeNull();
  });
});
