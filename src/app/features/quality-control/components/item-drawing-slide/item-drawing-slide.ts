import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PoButtonModule, PoPageSlideComponent, PoPageSlideModule } from '@po-ui/ng-components';

import { ItemDrawing, QualityControlService } from '../../services/quality-control';

@Component({
  selector: 'app-item-drawing-slide',
  imports: [PoButtonModule, PoPageSlideModule],
  templateUrl: './item-drawing-slide.html',
  styleUrls: ['./item-drawing-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemDrawingSlide {
  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  private readonly service = inject(QualityControlService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private objectUrl: string | null = null;
  private loadVersion = 0;

  readonly loading = signal(false);
  readonly drawing = signal<ItemDrawing | null>(null);
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  readonly feedback = signal('');

  constructor() {
    this.destroyRef.onDestroy(() => this.releaseObjectUrl());
  }

  open(itemCode: string): void {
    const normalized = itemCode.trim();
    if (!normalized || this.loading()) return;
    const version = ++this.loadVersion;
    this.releaseObjectUrl();
    this.drawing.set(null);
    this.pdfUrl.set(null);
    this.feedback.set('Carregando desenho do item...');
    this.loading.set(true);
    this.pageSlide.open();
    this.service.getItemDrawing(normalized)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: drawing => {
          if (version !== this.loadVersion) return;
          this.loading.set(false);
          if (!drawing?.found || !drawing.base64Content.trim()) {
            this.feedback.set(drawing?.message.trim() || 'Nenhum desenho foi encontrado para este item.');
            return;
          }
          try {
            this.objectUrl = createPdfObjectUrl(drawing.base64Content);
            this.drawing.set(drawing);
            this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
            this.feedback.set(drawing.message.trim() || 'Desenho carregado.');
          } catch {
            this.feedback.set('O desenho retornado não é um PDF válido.');
          }
        },
        error: () => {
          if (version !== this.loadVersion) return;
          this.loading.set(false);
          this.feedback.set('Não foi possível carregar o desenho. Verifique a conexão e tente novamente.');
        },
      });
  }

  close(): void {
    this.pageSlide.close();
  }

  onClose(): void {
    this.loadVersion += 1;
    this.loading.set(false);
    this.releaseObjectUrl();
    this.pdfUrl.set(null);
  }

  private releaseObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

export function createPdfObjectUrl(base64Content: string): string {
  const normalized = base64Content.replace(/\s/g, '');
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('invalid-pdf');
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}
