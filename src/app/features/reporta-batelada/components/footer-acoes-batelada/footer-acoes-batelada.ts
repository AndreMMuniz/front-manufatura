import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { PoButtonModule, PoWidgetModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-footer-acoes-batelada',
  imports: [PoButtonModule, PoWidgetModule],
  templateUrl: './footer-acoes-batelada.html',
  styleUrls: ['./footer-acoes-batelada.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterAcoesBatelada {
  @Input() startDisabled: boolean | null = null;
  @Input() startLoading = false;
  @Input() reportDisabled = true;
  @Input() reportLoading = false;
  @Input() endDisabled = true;
  @Input() endLoading = false;
  @Input() stopDisabled: boolean | null = null;

  // Compatibilidade temporária com o consumidor da 14.1 durante a orquestração da 14.2.
  @Input() primaryLabel = 'Iniciar';
  @Input() primaryDisabled = true;
  @Input() primaryLoading = false;
  @Input() paradaDisabled = true;

  @Output() start = new EventEmitter<void>();
  @Output() report = new EventEmitter<void>();
  @Output() end = new EventEmitter<void>();
  @Output() stop = new EventEmitter<void>();
  @Output() primaryAction = new EventEmitter<void>();
  @Output() parada = new EventEmitter<void>();
  @Output() voltar = new EventEmitter<void>();
  @Output() sair = new EventEmitter<void>();

  get effectiveStartDisabled(): boolean {
    return this.startDisabled ?? this.primaryDisabled;
  }

  get effectiveStartLoading(): boolean {
    return this.startLoading || this.primaryLoading;
  }

  get effectiveStopDisabled(): boolean {
    return this.stopDisabled ?? this.paradaDisabled;
  }

  emitStart(): void {
    this.start.emit();
    this.primaryAction.emit();
  }

  emitStop(): void {
    this.stop.emit();
    this.parada.emit();
  }
}
