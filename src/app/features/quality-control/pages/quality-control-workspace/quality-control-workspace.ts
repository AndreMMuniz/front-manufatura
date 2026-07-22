import { ChangeDetectionStrategy, Component, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';

import { PoButtonModule, PoDialogService, PoPageModule } from '@po-ui/ng-components';

import { ExamEntryPanel } from '../../components/exam-entry-panel/exam-entry-panel';
import { InspectionSection } from '../../components/inspection-section/inspection-section';
import { RouteGenerationSection } from '../../components/route-generation-section/route-generation-section';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

@Component({
  selector: 'app-quality-control-workspace',
  imports: [ExamEntryPanel, InspectionSection, RouteGenerationSection, PoButtonModule, PoPageModule],
  providers: [QualityControlWorkflowState],
  templateUrl: './quality-control-workspace.html',
  styleUrls: ['./quality-control-workspace.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QualityControlWorkspacePage {
  @ViewChild(InspectionSection) private inspectionSection?: InspectionSection;

  readonly workflow = inject(QualityControlWorkflowState);
  private readonly router = inject(Router);
  private readonly dialog = inject(PoDialogService);

  goBack(): void {
    if (this.workflow.isBusy()) return;
    this.runAfterGlobalDiscard('Voltar ao centro de trabalho?', () => {
      this.workflow.reset();
      void this.router.navigate(['/work-center']);
    });
  }

  exit(): void {
    if (this.workflow.isBusy()) return;
    this.runAfterGlobalDiscard('Sair do Plano Controle CQ?', () => this.workflow.reset());
  }

  restoreInspectionFocus(): void {
    this.inspectionSection?.restoreFocus();
  }

  private runAfterGlobalDiscard(title: string, action: () => void): void {
    if (!this.workflow.isDirty()) {
      action();
      return;
    }
    this.dialog.confirm({
      title,
      message: 'Todas as medições não salvas deste roteiro serão descartadas.',
      literals: { cancel: 'Cancelar', confirm: 'Descartar' },
      confirm: () => {
        this.workflow.discardAllDrafts();
        action();
      },
    });
  }
}
