import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, ViewChildren, QueryList, effect, inject, signal } from '@angular/core';

import { PoButtonModule, PoDialogService } from '@po-ui/ng-components';
import { map } from 'rxjs';

import { EquipesService } from '../../../equipes/services/equipes.service';
import { OperatorService } from '../../../shop-floor/services/operator';
import { formatExamFrequency } from '../../models/format-exam-frequency';
import { QualityExamComponent } from '../../models/quality-exam';
import { QualityControlWorkflowState } from '../../services/quality-control-workflow-state';

@Component({
  selector: 'app-inspection-section',
  imports: [PoButtonModule],
  templateUrl: './inspection-section.html',
  styleUrls: ['./inspection-section.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectionSection {
  @ViewChild('measurementButton', { read: ElementRef }) private measurementButton?: ElementRef<HTMLElement>;
  @ViewChildren('componentButton', { read: ElementRef }) private componentButtons?: QueryList<ElementRef<HTMLElement>>;

  readonly workflow = inject(QualityControlWorkflowState);
  readonly formatExamFrequency = formatExamFrequency;
  readonly responsibleName = signal('');
  private readonly dialog = inject(PoDialogService);
  private readonly operatorService = inject(OperatorService);
  private readonly equipesService = inject(EquipesService);
  private readonly resolveResponsible = effect(onCleanup => {
    const route = this.workflow.route();
    const type = route?.responsibleType;
    const code = route?.responsibleCode?.trim() ?? '';
    this.responsibleName.set('');
    if (!code || (type !== 'OPERADOR' && type !== 'EQUIPE')) return;

    const request = type === 'EQUIPE'
      ? this.equipesService.consultarEquipe(code).pipe(map(team => team.descricao))
      : this.operatorService.searchOperators(code).pipe(map(operators =>
          operators.find(operator =>
            this.normalizeCode(operator.code) === this.normalizeCode(code))?.name));
    const subscription = request.subscribe({
      next: name => this.responsibleName.set(name?.trim() ?? ''),
      error: () => this.responsibleName.set(''),
    });
    onCleanup(() => subscription.unsubscribe());
  });

  get responsibleLabel(): 'Operador' | 'Equipe' {
    return this.workflow.route()?.responsibleType === 'EQUIPE' ? 'Equipe' : 'Operador';
  }

  get canOpenExamEntry(): boolean {
    const selected = this.workflow.selectedComponent();
    return Boolean(selected && !this.workflow.isBusy());
  }

  selectComponent(component: QualityExamComponent): void {
    if (this.workflow.isBusy() || component.id === this.workflow.selectedComponentId()) return;
    const nextOpen = this.workflow.components().find(item => !this.isCompleted(item));
    if (nextOpen && nextOpen.id !== component.id && !this.isCompleted(component)) {
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
    return Boolean(component.measurement);
  }

  isApproved(component: QualityExamComponent): boolean {
    return component.measurement?.withinRange === true;
  }

  isRejected(component: QualityExamComponent): boolean {
    return component.measurement?.withinRange === false;
  }

  statusLabel(component: QualityExamComponent): string {
    if (this.isApproved(component)) return 'Aprovado';
    if (this.isRejected(component)) return 'Reprovado pelo Datasul';
    if (component.measurement?.deliveryStatus === 'SYNCED') return 'Sincronizado — aguardando decisão funcional';
    if (component.measurement) return 'Registrado localmente — envio pendente';
    if (this.workflow.isComponentOutOfRange(component.id)) return 'Resultado fora da referência local';
    return this.isSelected(component) ? 'Em inspeção' : 'Pendente';
  }

  measurementResult(component: QualityExamComponent): string | null {
    const measurement = component.measurement;
    if (!measurement) return null;
    if (measurement.selectedOption) return measurement.selectedOption.description;
    return measurement.result === undefined ? null : this.formatMeasurementValue(measurement.result);
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
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private normalizeCode(value: string): string {
    return value.trim().toUpperCase();
  }
}
