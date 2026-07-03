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
  @Input() primaryLabel = 'Iniciar';
  @Input() primaryDisabled = true;
  @Input() primaryLoading = false;
  @Input() paradaDisabled = true;

  @Output() primaryAction = new EventEmitter<void>();
  @Output() parada = new EventEmitter<void>();
  @Output() voltar = new EventEmitter<void>();
  @Output() sair = new EventEmitter<void>();
}
