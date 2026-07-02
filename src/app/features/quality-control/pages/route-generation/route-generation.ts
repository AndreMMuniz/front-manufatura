import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { PoButtonModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { MovimentaSaldoCheckbox } from '../../components/movimenta-saldo-checkbox/movimenta-saldo-checkbox';
import { OrdemInfoCard } from '../../components/ordem-info-card/ordem-info-card';
import { OrdemSearch } from '../../components/ordem-search/ordem-search';
import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityControlService } from '../../services/quality-control';

@Component({
  selector: 'app-route-generation',
  imports: [MovimentaSaldoCheckbox, OrdemInfoCard, OrdemSearch, PoButtonModule, PoPageModule, PoWidgetModule],
  templateUrl: './route-generation.html',
  styleUrls: ['./route-generation.css'],
})
export class RouteGenerationPage {
  orderNumber = '';
  opNumber = '';
  split = '';
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
    return Boolean(this.orderNumber.trim() && this.opNumber.trim()) && !this.isBusy;
  }

  get canGenerateRoute(): boolean {
    return Boolean(this.productionOrderRoute) && !this.isBusy;
  }

  get isBusy(): boolean {
    return this.isSearching || this.isGenerating;
  }

  searchOrder(): void {
    if (!this.canSearchOrder) {
      this.feedback = 'Informe Ordem e OP para consultar.';
      return;
    }

    this.isSearching = true;
    this.feedback = 'Consultando Ordem no Datasul...';
    this.productionOrderRoute = undefined;

    this.qualityControlService
      .getProductionOrderRoute({
        opNumber: this.orderNumber.trim(),
        operationCode: this.opNumber.trim(),
        split: this.split.trim(),
      })
      .subscribe({
        next: route => {
          this.productionOrderRoute = route;
          this.isSearching = false;
          this.feedback = 'Ordem localizada no Datasul.';
        },
        error: () => {
          this.isSearching = false;
          this.productionOrderRoute = undefined;
          this.feedback = 'Nao foi possivel consultar a Ordem no Datasul.';
        },
      });
  }

  scanOrder(): void {
    if (this.isBusy) {
      return;
    }

    this.orderNumber = '372635';
    this.opNumber = '10';
    this.split = '1';
    this.feedback = 'Leitura por scanner simulada.';
    this.searchOrder();
  }

  clearSearch(): void {
    if (this.isBusy) {
      return;
    }

    this.orderNumber = '';
    this.opNumber = '';
    this.split = '';
    this.moveBalance = false;
    this.productionOrderRoute = undefined;
    this.feedback = '';
  }

  generateRoute(): void {
    if (!this.productionOrderRoute || !this.canGenerateRoute) {
      this.feedback = 'Localize uma Ordem valida antes de gerar o roteiro.';
      return;
    }

    const route = this.productionOrderRoute;
    this.isGenerating = true;
    this.feedback = 'Gerando roteiro de inspecao...';

    this.qualityControlService.generateInspectionRoute({ route, moveBalance: this.moveBalance }).subscribe({
      next: generatedRoute => {
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
      void this.router.navigate(['/menu']);
    }
  }
}
