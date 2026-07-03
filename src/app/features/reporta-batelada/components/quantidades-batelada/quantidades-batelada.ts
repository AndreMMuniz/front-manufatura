import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-quantidades-batelada',
  imports: [FormsModule, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './quantidades-batelada.html',
  styleUrls: ['./quantidades-batelada.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantidadesBatelada {
  @Input() quantidadeRefugo = 0;
  @Input() quantidadeRetrabalho = 0;
  @Input() disabled = true;

  @Output() editarRefugo = new EventEmitter<void>();
  @Output() editarRetrabalho = new EventEmitter<void>();
}
