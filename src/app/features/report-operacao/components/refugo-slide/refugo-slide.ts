import { ChangeDetectionStrategy, Component, EventEmitter, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoPageSlideComponent, PoPageSlideModule } from '@po-ui/ng-components';

export interface RefugoRegistrado {
  readonly quantidade: number;
  readonly motivo: string;
}

@Component({
  selector: 'app-refugo-slide',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoPageSlideModule],
  templateUrl: './refugo-slide.html',
  styleUrls: ['./refugo-slide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefugoSlide {
  @Output() refugoRegistrado = new EventEmitter<RefugoRegistrado>();

  @ViewChild('pageSlide', { static: true }) private pageSlide!: PoPageSlideComponent;

  quantidade = 0;
  motivo = '';

  get canSalvar(): boolean {
    return this.quantidade > 0 && Boolean(this.motivo.trim());
  }

  abrir(quantidadeAtual: number): void {
    this.quantidade = quantidadeAtual;
    this.motivo = '';
    this.pageSlide.open();
  }

  salvar(): void {
    if (!this.canSalvar) {
      return;
    }

    this.refugoRegistrado.emit({
      quantidade: this.quantidade,
      motivo: this.motivo.trim(),
    });
    this.fechar();
  }

  fechar(): void {
    this.pageSlide.close();
  }
}
