import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { PoButtonModule, PoFieldModule, PoPageModule, PoSelectOption, PoWidgetModule } from '@po-ui/ng-components';

import { Operator } from '../../models/operator';
import { ReportType } from '../../models/operational-context';
import { WorkCenter } from '../../models/work-center';
import { OperationalContextService } from '../../services/operational-context';
import { OperatorService } from '../../services/operator';
import { WorkCenterService } from '../../services/work-center';

@Component({
  selector: 'app-work-center',
  imports: [CommonModule, FormsModule, PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule],
  templateUrl: './work-center.html',
  styleUrls: ['./work-center.css'],
})
export class WorkCenterPage implements OnInit {
  private readonly router = inject(Router);
  private readonly workCenterService = inject(WorkCenterService);
  private readonly operatorService = inject(OperatorService);
  private readonly operationalContextService = inject(OperationalContextService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private workCenterLookupVersion = 0;
  private operatorLookupVersion = 0;

  workCenterCode = '';
  operatorCode = '';
  reportType: ReportType = 'OPERATOR';
  validity = '';
  feedback = '';
  isLoadingWorkCenter = false;
  isLoadingOperator = false;
  selectedWorkCenter: WorkCenter | null = null;
  selectedOperator: Operator | null = null;
  readonly reportTypeOptions: Array<PoSelectOption> = [
    { label: 'Operador', value: 'OPERATOR' },
    { label: 'Batelada', value: 'BATCH' },
  ];

  ngOnInit(): void {
    this.selectedWorkCenter = this.workCenterService.selectedWorkCenter;
    this.workCenterCode = this.selectedWorkCenter?.code ?? '';
    this.selectedOperator = this.operatorService.selectedOperator;
    this.operatorCode = this.selectedOperator?.code ?? '';
  }

  get canUseOperatorField(): boolean {
    return this.selectedWorkCenter !== null;
  }

  get canUseReportType(): boolean {
    return this.selectedWorkCenter !== null;
  }

  get hasCompleteOperationalContext(): boolean {
    return Boolean(this.selectedWorkCenter && this.selectedOperator && this.reportType && this.validity.trim());
  }

  get canContinueToReport(): boolean {
    return this.hasCompleteOperationalContext;
  }

  get canContinueToInspection(): boolean {
    return this.hasCompleteOperationalContext;
  }

  validateWorkCenter(): void {
    const code = this.workCenterCode.trim();

    if (!code) {
      this.resetWorkCenterContext();
      this.feedback = 'Informe o Centro de Trabalho.';
      return;
    }

    const lookupVersion = ++this.workCenterLookupVersion;
    const previousWorkCenterCode = this.selectedWorkCenter?.code ?? null;
    this.isLoadingWorkCenter = true;
    this.workCenterService.selectWorkCenter(code).subscribe({
      next: workCenter => {
        if (
          lookupVersion !== this.workCenterLookupVersion ||
          this.normalizeCode(this.workCenterCode) !== this.normalizeCode(code)
        ) {
          return;
        }

        this.isLoadingWorkCenter = false;
        this.selectedWorkCenter = workCenter;

        if (!workCenter) {
          this.resetWorkCenterContext(false);
          this.feedback = 'Centro de Trabalho não encontrado.';
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.workCenterCode = workCenter.code;
        this.resetOperatorContext();

        if (previousWorkCenterCode !== workCenter.code) {
          this.resetReportType();
        }

        this.feedback = 'Centro de Trabalho carregado.';
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        if (lookupVersion !== this.workCenterLookupVersion) {
          return;
        }

        this.isLoadingWorkCenter = false;
        this.resetWorkCenterContext(false);
        this.feedback = 'Não foi possível validar o Centro de Trabalho.';
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  validateOperator(): void {
    const code = this.operatorCode.trim();

    if (!this.selectedWorkCenter) {
      this.resetOperatorContext(false);
      this.feedback = 'Informe o Centro de Trabalho antes do Operador.';
      return;
    }

    if (!code) {
      this.resetOperatorContext(false);
      this.feedback = 'Informe o Operador.';
      return;
    }

    const lookupVersion = ++this.operatorLookupVersion;
    this.isLoadingOperator = true;
    this.operatorService.selectOperator(code).subscribe({
      next: operator => {
        if (
          lookupVersion !== this.operatorLookupVersion ||
          this.normalizeCode(this.operatorCode) !== this.normalizeCode(code)
        ) {
          return;
        }

        this.isLoadingOperator = false;
        this.selectedOperator = operator;

        if (!operator) {
          this.resetOperatorContext(false);
          this.feedback = 'Operador não encontrado ou inativo.';
          this.changeDetectorRef.markForCheck();
          return;
        }

        this.operatorCode = operator.code;
        this.validity = '';
        this.operationalContextService.clearContext();
        this.feedback = 'Operador validado.';
        this.changeDetectorRef.markForCheck();
      },
      error: () => {
        if (lookupVersion !== this.operatorLookupVersion) {
          return;
        }

        this.isLoadingOperator = false;
        this.resetOperatorContext(false);
        this.feedback = 'Não foi possível validar o Operador.';
        this.changeDetectorRef.markForCheck();
      },
    });
  }

  onWorkCenterCodeChange(code: string): void {
    const codeChanged = this.normalizeCode(this.workCenterCode) !== this.normalizeCode(code);
    this.workCenterCode = code;

    if (
      (this.isLoadingWorkCenter && codeChanged) ||
      (this.selectedWorkCenter && this.normalizeCode(this.selectedWorkCenter.code) !== this.normalizeCode(code))
    ) {
      this.workCenterLookupVersion++;
      this.isLoadingWorkCenter = false;
      this.resetWorkCenterContext(false);
    }
  }

  onOperatorCodeChange(code: string): void {
    const codeChanged = this.normalizeCode(this.operatorCode) !== this.normalizeCode(code);
    this.operatorCode = code;

    if (
      (this.isLoadingOperator && codeChanged) ||
      (this.selectedOperator && this.normalizeCode(this.selectedOperator.code) !== this.normalizeCode(code))
    ) {
      this.operatorLookupVersion++;
      this.isLoadingOperator = false;
      this.resetOperatorContext(false);
    }
  }

  onReportTypeChange(reportType: ReportType): void {
    this.reportType = reportType;
    this.operationalContextService.clearContext();
  }

  onValidityChange(value: string): void {
    this.validity = value;
    this.operationalContextService.clearContext();
  }

  showScannerUnavailable(): void {
    this.feedback = 'Leitura por scanner ainda não disponível.';
  }

  goToReport(): void {
    if (!this.storeOperationalContext()) {
      this.feedback = 'Complete Centro de Trabalho, Operador e Validade para acessar o Report.';
      return;
    }

    void this.router.navigate([this.reportType === 'BATCH' ? '/batch-reporting' : '/operation-reporting']);
  }

  goToInspection(): void {
    if (!this.storeOperationalContext()) {
      return;
    }

    void this.router.navigate(['/quality-control']);
  }

  private storeOperationalContext(): boolean {
    if (!this.selectedWorkCenter || !this.selectedOperator || !this.validity.trim()) {
      this.feedback = 'Complete os dados antes de continuar.';
      return false;
    }

    this.operationalContextService.setContext({
      workCenter: this.selectedWorkCenter,
      operator: this.selectedOperator,
      reportType: this.reportType,
      validity: this.validity.trim(),
    });

    return true;
  }

  private resetWorkCenterContext(clearCode = true): void {
    if (clearCode) {
      this.workCenterCode = '';
    }

    this.workCenterService.clearSelection();
    this.selectedWorkCenter = null;
    this.resetReportType();
    this.resetOperatorContext();
  }

  private resetOperatorContext(clearCode = true): void {
    if (clearCode) {
      this.operatorCode = '';
    }

    this.operatorService.clearSelection();
    this.operationalContextService.clearContext();
    this.selectedOperator = null;
    this.validity = '';
  }

  private resetReportType(): void {
    this.reportType = 'OPERATOR';
    this.operationalContextService.clearContext();
  }

  private normalizeCode(code: string): string {
    return code.trim().toLowerCase();
  }
}
