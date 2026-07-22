import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PoButtonModule, PoDialogService, PoWidgetModule } from '@po-ui/ng-components';

import { MovimentaSaldoCheckbox } from '../movimenta-saldo-checkbox/movimenta-saldo-checkbox';
import { OrdemInfoCard } from '../ordem-info-card/ordem-info-card';
import { OrdemSearch } from '../ordem-search/ordem-search';
import { ProductionOrderOperation } from '../../models/production-order-route';
import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

@Component({
  selector: 'app-route-generation-section',
  imports: [MovimentaSaldoCheckbox, OrdemInfoCard, OrdemSearch, PoButtonModule, PoWidgetModule],
  templateUrl: './route-generation-section.html',
  styleUrls: ['./route-generation-section.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteGenerationSection {
  readonly workflow = inject(QualityControlWorkflowState);
  private readonly qualityControlService = inject(QualityControlService);
  private readonly dialog = inject(PoDialogService);
  private readonly destroyRef = inject(DestroyRef);

  get canSearchOrder(): boolean {
    return Boolean(this.workflow.orderNumber().trim()) && !this.workflow.isBusy();
  }

  get canGenerateRoute(): boolean {
    return Boolean(this.workflow.selectedOperation())
      && !this.workflow.route()?.routeNumber
      && !this.workflow.isBusy();
  }

  searchOrder(): void {
    if (!this.canSearchOrder) {
      this.workflow.routeFeedback.set('Informe a Ordem de Produção para consultar.');
      return;
    }

    const orderNumber = this.workflow.orderNumber().trim();
    const token = this.workflow.beginOrderLookup(orderNumber);
    this.qualityControlService.getProductionOrderOperations(orderNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => this.workflow.completeOrderLookup(token, result.orderNumber, result.operations),
        error: () => this.workflow.failOrderLookup(token),
      });
  }

  scanOrder(): void {
    if (this.workflow.isBusy()) return;
    this.workflow.updateOrderNumber('325571');
    this.workflow.routeFeedback.set('Leitura por scanner simulada.');
    this.searchOrder();
  }

  updateOrderNumber(orderNumber: string): void {
    if (orderNumber === this.workflow.orderNumber()) return;
    this.runAfterDraftConfirmation(
      'Trocar Ordem de Produção?',
      'As medições não salvas do roteiro atual serão descartadas.',
      () => this.workflow.updateOrderNumber(orderNumber),
    );
  }

  selectOperation(operation: ProductionOrderOperation): void {
    if (!this.workflow.isBusy()) this.workflow.selectOperation(operation);
  }

  clearSearch(): void {
    if (this.workflow.isBusy()) return;
    this.runAfterDraftConfirmation(
      'Limpar Plano Controle CQ?',
      'As medições não salvas do roteiro atual serão descartadas.',
      () => this.workflow.reset(),
    );
  }

  generateRoute(): void {
    const operation = this.workflow.selectedOperation();
    if (!operation || !this.canGenerateRoute) {
      this.workflow.routeFeedback.set('Selecione uma operação antes de gerar o roteiro.');
      return;
    }

    const token = this.workflow.beginRouteGeneration();
    this.qualityControlService.generateInspectionRoute({
      orderNumber: this.workflow.orderNumber(),
      operation,
      moveBalance: this.workflow.moveBalance(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: route => {
          if (!this.workflow.setGeneratedRoute(route, token)) return;
          this.loadExams();
        },
        error: () => this.workflow.failRouteGeneration(token),
      });
  }

  retryExamLoad(): void {
    this.loadExams();
  }

  private loadExams(): void {
    const route = this.workflow.route();
    const token = this.workflow.beginExamLoad();
    if (!route || token === null) return;

    this.qualityControlService.getQualityExams(route.itemCode, route.operationCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: exams => this.workflow.completeExamLoad(token, exams),
        error: () => this.workflow.failExamLoad(token),
      });
  }

  private runAfterDraftConfirmation(title: string, message: string, action: () => void): void {
    if (!this.workflow.isDirty()) {
      action();
      return;
    }

    this.dialog.confirm({
      title,
      message,
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
      confirm: action,
    });
  }
}
