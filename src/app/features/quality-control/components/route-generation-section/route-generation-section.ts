import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoDialogService, PoFieldModule, PoWidgetModule } from '@po-ui/ng-components';

import { OrdemInfoCard } from '../ordem-info-card/ordem-info-card';
import { OrdemSearch } from '../ordem-search/ordem-search';
import { BarcodeScanner } from '../barcode-scanner/barcode-scanner';
import { ProductionOrderOperation } from '../../models/production-order-route';
import { QualityControlService } from '../../services/quality-control';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

@Component({
  selector: 'app-route-generation-section',
  imports: [BarcodeScanner, FormsModule, OrdemInfoCard, OrdemSearch, PoButtonModule, PoFieldModule, PoWidgetModule],
  templateUrl: './route-generation-section.html',
  styleUrls: ['./route-generation-section.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteGenerationSection {
  readonly workflow = inject(QualityControlWorkflowState);
  private readonly qualityControlService = inject(QualityControlService);
  private readonly dialog = inject(PoDialogService);
  private readonly destroyRef = inject(DestroyRef);
  scannerOpen = false;

  get canSearchOrder(): boolean {
    return Boolean(this.workflow.orderNumber().trim()) && !this.workflow.isBusy();
  }

  get canGenerateRoute(): boolean {
    return Boolean(this.workflow.selectedOperation())
      && Boolean(this.workflow.responsibleCode().trim())
      && !this.workflow.route()?.routeNumber
      && !this.workflow.isBusy();
  }

  get responsibleLabel(): 'Operador' | 'Equipe' {
    return this.workflow.responsibleType() === 'EQUIPE' ? 'Equipe' : 'Operador';
  }

  formatHistoryDate(date: string | null): string {
    if (!date) return 'Data não informada';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
    return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : date;
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
        next: result => this.workflow.completeOrderLookup(
          token,
          result.orderNumber,
          result.operations,
          result.routeHistory,
        ),
        error: () => this.workflow.failOrderLookup(token),
      });
  }

  scanOrder(): void {
    if (this.workflow.isBusy()) return;
    this.scannerOpen = true;
  }

  closeScanner(): void {
    this.scannerOpen = false;
  }

  useScannedOrder(value: string): void {
    const orderNumber = value.trim();
    this.closeScanner();
    if (!orderNumber) {
      this.workflow.routeFeedback.set('O código lido não contém uma Ordem válida.');
      return;
    }
    this.workflow.updateOrderNumber(orderNumber);
    this.searchOrder();
  }

  handleScannerFailure(message: string): void {
    this.closeScanner();
    this.workflow.routeFeedback.set(message);
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

  updateResponsibleCode(value: string): void {
    if (!this.workflow.isBusy()) this.workflow.responsibleCode.set(value ?? '');
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
    if (!operation) {
      this.workflow.routeFeedback.set('Selecione uma operação antes de gerar o roteiro.');
      return;
    }
    const responsibleCode = this.workflow.responsibleCode().trim();
    if (!responsibleCode) {
      this.workflow.routeFeedback.set(`Informe o código d${this.responsibleLabel === 'Equipe' ? 'a' : 'o'} ${this.responsibleLabel}.`);
      return;
    }
    if (!this.canGenerateRoute) return;

    const token = this.workflow.beginRouteGeneration();
    this.qualityControlService.generateInspectionRoute({
      orderNumber: this.workflow.orderNumber(),
      operation,
      responsibleType: this.workflow.responsibleType(),
      responsibleCode,
      moveBalance: this.workflow.moveBalance(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: route => {
          if (!this.workflow.setGeneratedRoute(route, token)) return;
          this.loadExams();
        },
        error: error => this.workflow.failRouteGeneration(token, routeGenerationErrorMessage(error)),
      });
  }

  retryExamLoad(): void {
    this.loadExams();
  }

  private loadExams(): void {
    const route = this.workflow.route();
    const token = this.workflow.beginExamLoad();
    if (!route || token === null) return;

    this.qualityControlService.getQualityExams(route)
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

function routeGenerationErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return undefined;
  const body = error.error;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  return record['code'] === 'route-already-in-progress' && typeof record['message'] === 'string'
    ? record['message']
    : undefined;
}
