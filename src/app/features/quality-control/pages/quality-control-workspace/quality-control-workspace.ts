import { ChangeDetectionStrategy, Component, DestroyRef, ViewChild, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';

import { PoButtonModule, PoDialogService, PoPageModule } from '@po-ui/ng-components';

import { ExamEntryPanel } from '../../components/exam-entry-panel/exam-entry-panel';
import { InspectionSection } from '../../components/inspection-section/inspection-section';
import { RouteGenerationSection } from '../../components/route-generation-section/route-generation-section';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';
import { QualityControlService } from '../../services/quality-control';
import { PwaWorkStateService } from '../../../../core/offline/pwa/pwa-work-state.service';
import {
  OperationalCorrectionNotice,
} from '../../../../core/offline/components/operational-correction-notice/operational-correction-notice';

@Component({
  selector: 'app-quality-control-workspace',
  imports: [
    ExamEntryPanel,
    InspectionSection,
    RouteGenerationSection,
    OperationalCorrectionNotice,
    PoButtonModule,
    PoPageModule,
  ],
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
  private readonly pwaWorkState = inject(PwaWorkStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly qualityControl = inject(QualityControlService);

  constructor() {
    effect(() => {
      this.pwaWorkState.setCaptureActive(
        'quality-control',
        this.workflow.isDirty() || this.workflow.isBusy(),
      );
    });
    this.destroyRef.onDestroy(
      () => this.pwaWorkState.setCaptureActive('quality-control', false),
    );
    if (typeof this.qualityControl.restoreLatestConfirmedRoute !== 'function') return;
    this.qualityControl.restoreLatestConfirmedRoute().pipe(
      catchError(() => of(null)),
      switchMap(restored => restored
        ? this.qualityControl
            .getQualityExams(restored.route)
            .pipe(map(exams => ({ restored, exams })))
        : of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      if (!result || this.workflow.route()?.routeNumber) return;
      this.workflow.setGeneratedRoute(result.restored.route);
      const token = this.workflow.beginExamLoad();
      if (token !== null && this.workflow.completeExamLoad(token, result.exams)) {
        for (const saved of result.restored.measurements) {
          this.workflow.applyMeasurement(
            saved.examId,
            saved.componentId,
            saved.measurement,
          );
        }
        this.workflow.restoreCommandIdentities(
          result.restored.finishCommandIds,
          result.restored.inspectionCommandIds,
        );
        this.workflow.routeFeedback.set('Roteiro confirmado restaurado deste dispositivo.');
      }
    });
  }

  goBack(): void {
    if (this.workflow.isBusy() || !this.workflow.canLeaveWorkspace()) return;
    this.runAfterGlobalDiscard(
      'Voltar à localização da Ordem?',
      () => this.workflow.returnToOrderLocation(),
    );
  }

  exit(): void {
    if (this.workflow.isBusy() || !this.workflow.canLeaveWorkspace()) return;
    this.runAfterGlobalDiscard('Sair do Plano Controle CQ?', () => {
      this.workflow.reset();
      void this.router.navigate(['/menu']);
    });
  }

  restoreInspectionFocus(componentId?: string): void {
    this.inspectionSection?.restoreFocus(componentId);
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
