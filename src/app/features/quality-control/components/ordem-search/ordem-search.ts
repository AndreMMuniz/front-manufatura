import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule } from '@po-ui/ng-components';

import { ScannerButton } from '../scanner-button/scanner-button';

@Component({
  selector: 'app-ordem-search',
  imports: [FormsModule, PoButtonModule, PoFieldModule, ScannerButton],
  templateUrl: './ordem-search.html',
  styleUrls: ['./ordem-search.css'],
})
export class OrdemSearch {
  @Input() orderNumber = '';
  @Input() disabled = false;
  @Input() canSearch = false;

  @Output() orderNumberChange = new EventEmitter<string>();
  @Output() search = new EventEmitter<void>();
  @Output() scan = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();
}
