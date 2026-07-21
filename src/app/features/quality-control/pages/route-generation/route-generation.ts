import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { MovimentaSaldoCheckbox } from '../../components/movimenta-saldo-checkbox/movimenta-saldo-checkbox';
import { OrdemInfoCard } from '../../components/ordem-info-card/ordem-info-card';
import { OrdemSearch } from '../../components/ordem-search/ordem-search';
import {
  ProductionOrderOperation,
  ProductionOrderRoute,
} from '../../models/production-order-route';
import { QualityControlService } from '../../services/quality-control';

@Component({
  selector: 'app-route-generation',
  imports: [
    MovimentaSaldoCheckbox,
    OrdemInfoCard,
    OrdemSearch,
    PoButtonModule,
    PoPageModule,
    PoWidgetModule,
  ],
  templateUrl: './route-generation.html',
  styleUrls: ['./route-generation.css'],
})
export class RouteGenerationPage {
  orderNumber = '';
  operations: ProductionOrderOperation[] = [];
  selectedOperation?: ProductionOrderOperation;
  moveBalance = false;
  productionOrderRoute?: ProductionOrderRoute;
  feedback = '';
  isSearching = false;
  isGenerating = false;

  constructor(
    private readonly qualityControlService: QualityControlService,
    private readonly router: Router,
  ) {}

  get canSearchOrder(): boolean {
    return Boolean(this.orderNumber.trim()) && !this.isBusy;
  }

  get canGenerateRoute(): boolean {
    return Boolean(this.selectedOperation) && !this.isBusy;
  }

  get isBusy(): boolean {
    return this.isSearching || this.isGenerating;
  }

  searchOrder(): void {
    if (!this.canSearchOrder) {
      this.feedback = 'Informe a Ordem de Produção para consultar.';
      return;
    }

    this.isSearching = true;
    this.feedback = 'Consultando Ordem no Datasul...';
    this.operations = [];
    this.selectedOperation = undefined;
    this.productionOrderRoute = undefined;

    this.qualityControlService.getProductionOrderOperations(this.orderNumber.trim()).subscribe({
      next: (result) => {
        this.orderNumber = result.orderNumber;
        this.operations = result.operations;
        this.isSearching = false;
        this.feedback = this.operations.length
          ? 'Ordem localizada. Selecione uma operação para gerar o roteiro.'
          : 'Nenhuma operação foi encontrada para esta Ordem.';
      },
      error: () => {
        this.isSearching = false;
        this.operations = [];
        this.selectedOperation = undefined;
        this.productionOrderRoute = undefined;
        this.feedback = 'Nao foi possivel consultar a Ordem no Datasul.';
      },
    });
  }

  scanOrder(): void {
    if (this.isBusy) {
      return;
    }

    this.orderNumber = '325571';
    this.feedback = 'Leitura por scanner simulada.';
    this.searchOrder();
  }

  updateOrderNumber(orderNumber: string): void {
    if (orderNumber !== this.orderNumber) {
      this.operations = [];
      this.selectedOperation = undefined;
      this.productionOrderRoute = undefined;
      this.feedback = '';
    }

    this.orderNumber = orderNumber;
  }

  selectOperation(operation: ProductionOrderOperation): void {
    if (this.isBusy) {
      return;
    }

    this.selectedOperation = operation;
    this.productionOrderRoute = this.createRoutePreview(operation);
    this.feedback = `Operação ${operation.operationCode} selecionada.`;
  }

  isOperationSelected(operation: ProductionOrderOperation): boolean {
    return this.selectedOperation?.operationCode === operation.operationCode;
  }

  clearSearch(): void {
    if (this.isBusy) {
      return;
    }

    this.orderNumber = '';
    this.operations = [];
    this.selectedOperation = undefined;
    this.moveBalance = false;
    this.productionOrderRoute = undefined;
    this.feedback = '';
  }

  generateRoute(): void {
    if (!this.selectedOperation || !this.canGenerateRoute) {
      this.feedback = 'Selecione uma operação antes de gerar o roteiro.';
      return;
    }

    const operation = this.selectedOperation;
    this.isGenerating = true;
    this.feedback = 'Gerando roteiro de inspecao...';

    this.qualityControlService
      .generateInspectionRoute({
        orderNumber: this.orderNumber,
        operation,
        moveBalance: this.moveBalance,
      })
      .subscribe({
        next: (generatedRoute) => {
          this.isGenerating = false;
          this.feedback = 'Roteiro gerado.';
          void this.router.navigate(['/quality-control/inspection'], {
            state: { productionOrderRoute: generatedRoute },
          });
        },
        error: () => {
          this.isGenerating = false;
          this.feedback = 'Nao foi possivel gerar o roteiro.';
        },
      });
  }

  goBack(): void {
    if (!this.isBusy) {
      void this.router.navigate(['/work-center']);
    }
  }

  exit(): void {
    if (!this.isBusy) {
      void this.router.navigate(['/quality-control']);
    }
  }

  private createRoutePreview(operation: ProductionOrderOperation): ProductionOrderRoute {
    return {
      routeNumber: '',
      processDescription: operation.processDescription,
      currentOrder: this.orderNumber,
      operationCode: operation.operationCode,
      operationDescription: `${operation.operationCode} - ${operation.operationDescription}`,
      split: operation.split ?? '',
      itemCode: operation.itemCode,
      itemDescription: operation.itemDescription,
    };
  }
}
