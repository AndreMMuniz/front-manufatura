import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { Operator } from '../../models/operator';
import { OperatorService } from '../../services/operator';

@Component({
  selector: 'app-operators',
  imports: [CommonModule, FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule],
  templateUrl: './operators.html',
  styleUrls: ['./operators.css'],
})
export class OperatorsPage implements OnInit {
  private readonly router = inject(Router);
  private readonly operatorService = inject(OperatorService);

  searchTerm = '';
  operators: ReadonlyArray<Operator> = [];
  selectedOperator: Operator | null = null;

  ngOnInit(): void {
    this.selectedOperator = this.operatorService.selectedOperator;
    this.loadOperators();
  }

  search(): void {
    this.operatorService.searchOperators(this.searchTerm).subscribe(operators => {
      this.operators = operators;
    });
  }

  selectOperator(operator: Operator): void {
    this.operatorService.selectOperator(operator.code).subscribe(selected => {
      this.selectedOperator = selected;
    });
  }

  clearSelection(): void {
    this.operatorService.clearSelection();
    this.selectedOperator = null;
  }

  backToDefaultModule(): void {
    void this.router.navigate(['/quality-control']);
  }

  statusLabel(operator: Operator): string {
    return operator.active ? 'Ativo' : 'Inativo';
  }

  private loadOperators(): void {
    this.operatorService.listOperators().subscribe(operators => {
      this.operators = operators;
    });
  }
}
