import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoFieldModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-movimenta-saldo-checkbox',
  imports: [FormsModule, PoFieldModule],
  templateUrl: './movimenta-saldo-checkbox.html',
  styleUrls: ['./movimenta-saldo-checkbox.css'],
})
export class MovimentaSaldoCheckbox {
  @Input() moveBalance = false;
  @Input() disabled = false;

  @Output() moveBalanceChange = new EventEmitter<boolean>();
}
