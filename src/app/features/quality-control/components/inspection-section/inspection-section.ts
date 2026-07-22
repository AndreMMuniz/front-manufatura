import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, ViewChildren, QueryList, inject } from '@angular/core';

import { PoButtonModule, PoDialogService, PoProgressModule, PoWidgetModule } from '@po-ui/ng-components';

import { formatExamFrequency } from '../../models/format-exam-frequency';
import { QualityExamComponent } from '../../models/quality-exam';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

@Component({
  selector: 'app-inspection-section',
  imports: [PoButtonModule, PoProgressModule, PoWidgetModule],
  templateUrl: './inspection-section.html',
  styleUrls: ['./inspection-section.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectionSection {
  @ViewChild('measurementButton', { read: ElementRef }) private measurementButton?: ElementRef<HTMLElement>;
  @ViewChildren('componentButton', { read: ElementRef }) private componentButtons?: QueryList<ElementRef<HTMLElement>>;

  readonly workflow = inject(QualityControlWorkflowState);
  readonly formatExamFrequency = formatExamFrequency;
  private readonly dialog = inject(PoDialogService);

  get progressText(): string {
    return `${this.workflow.completedCount()} de ${this.workflow.components().length} componentes concluídos`;
  }

  get canOpenExamEntry(): boolean {
    const selected = this.workflow.selectedComponent();
    return Boolean(selected && selected.measurement?.status !== 'APPROVED' && !this.workflow.isBusy());
  }

  selectComponent(component: QualityExamComponent): void {
    if (this.workflow.isBusy() || component.id === this.workflow.selectedComponentId()) return;
    const nextOpen = this.workflow.components().find(item => item.measurement?.status !== 'APPROVED');
    if (nextOpen && nextOpen.id !== component.id && component.measurement?.status !== 'APPROVED') {
      this.workflow.inspectionFeedback.set('Siga a sequência do roteiro definida pelo Datasul.');
      return;
    }

    const currentId = this.workflow.selectedComponentId();
    const action = () => this.workflow.selectComponent(component.id);
    if (currentId && this.workflow.isComponentDirty(currentId)) {
      this.dialog.confirm({
        title: 'Trocar componente?',
        message: 'A medição não salva do componente atual será descartada.',
        literals: { cancel: 'Cancelar', confirm: 'Descartar' },
        confirm: () => {
          this.workflow.discardDraft(currentId);
          action();
        },
      });
      return;
    }
    action();
  }

  openExamEntry(): void {
    const selected = this.workflow.selectedComponent();
    if (selected && this.canOpenExamEntry) this.workflow.openPanel(selected.id);
  }

  restoreFocus(componentId?: string): void {
    if (componentId) {
      const index = this.workflow.components().findIndex(component => component.id === componentId);
      const target = index >= 0 ? this.componentButtons?.get(index) : undefined;
      if (target) {
        target.nativeElement.focus();
        return;
      }
    }
    this.measurementButton?.nativeElement.focus();
  }

  isSelected(component: QualityExamComponent): boolean {
    return component.id === this.workflow.selectedComponentId();
  }

  isCompleted(component: QualityExamComponent): boolean {
    return component.measurement?.status === 'APPROVED';
  }

  statusLabel(component: QualityExamComponent): string {
    if (component.measurement?.status === 'APPROVED') return 'Aprovado';
    if (this.workflow.isComponentOutOfRange(component.id)) return 'Valores fora da variação permitida';
    return this.isSelected(component) ? 'Em inspeção' : 'Pendente';
  }

  formatMeasurementValue(value: number): string {
    return value.toLocaleString('pt-BR', {
      useGrouping: false,
      maximumFractionDigits: 20,
    });
  }

  measurementSavedAt(component: QualityExamComponent): string | null {
    const savedAt = component.measurement?.savedAt;
    if (!savedAt) return null;

    const date = savedAt instanceof Date ? savedAt : new Date(savedAt);
    if (Number.isNaN(date.getTime())) return null;

    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}
