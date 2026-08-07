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
  @Input() startDisabled = true;
  @Input() startLoading = false;
  @Input() reportDisabled = true;
  @Input() reportLoading = false;
  @Input() stopDisabled = true;

  @Output() start = new EventEmitter<void>();
  @Output() report = new EventEmitter<void>();
  @Output() stop = new EventEmitter<void>();
  @Output() sair = new EventEmitter<void>();
}
