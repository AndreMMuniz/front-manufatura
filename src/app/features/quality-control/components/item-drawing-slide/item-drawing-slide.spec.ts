import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PoPageSlideComponent } from '@po-ui/ng-components';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QualityControlService } from '../../services/quality-control';
import { ItemDrawingSlide } from './item-drawing-slide';

describe('ItemDrawingSlide', () => {
  let fixture: ComponentFixture<ItemDrawingSlide>;
  let component: ItemDrawingSlide;
  let service: { getItemDrawing: ReturnType<typeof vi.fn> };
  let pageSlide: PoPageSlideComponent;

  beforeEach(async () => {
    service = { getItemDrawing: vi.fn() };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:desenho-30907');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [ItemDrawingSlide],
      providers: [
        provideNoopAnimations(),
        { provide: QualityControlService, useValue: service },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ItemDrawingSlide);
    component = fixture.componentInstance;
    pageSlide = fixture.debugElement.query(By.directive(PoPageSlideComponent)).componentInstance;
    vi.spyOn(pageSlide, 'open');
  });

  afterEach(() => vi.restoreAllMocks());

  it('abre o drawer e exibe o PDF retornado para o item', () => {
    service.getItemDrawing.mockReturnValue(of({
      sizeBytes: 9,
      fileName: '30907_REV_R.pdf',
      message: 'Desenho encontrado',
      revisionCode: 'R',
      found: true,
      itemCode: '30907',
      base64Content: btoa('%PDF-1.4'),
    }));

    component.open('30907');
    fixture.detectChanges();

    expect(pageSlide.open).toHaveBeenCalledOnce();
    expect(service.getItemDrawing).toHaveBeenCalledWith('30907');
    expect(fixture.nativeElement.textContent).toContain('30907');
    expect(fixture.nativeElement.textContent).toContain('30907_REV_R.pdf');
    expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
  });

  it('informa ausência de arquivo sem tentar criar URL', () => {
    service.getItemDrawing.mockReturnValue(of(null));
    component.open('30907');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nenhum desenho foi encontrado');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('mostra falha amigável e libera a URL ao fechar', () => {
    service.getItemDrawing.mockReturnValue(throwError(() => new Error('offline')));
    component.open('30907');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Verifique a conexão');

    service.getItemDrawing.mockReturnValue(of({
      sizeBytes: 9, fileName: 'a.pdf', message: '', revisionCode: 'R', found: true,
      itemCode: '30907', base64Content: btoa('%PDF-1.4'),
    }));
    component.open('30907');
    component.onClose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:desenho-30907');
  });
});
