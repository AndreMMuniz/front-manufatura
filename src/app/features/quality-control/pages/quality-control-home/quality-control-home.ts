import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { PoButtonModule, PoPageModule, PoProgressModule, PoWidgetModule } from '@po-ui/ng-components';

import { OrdemInfoCard } from '../../components/ordem-info-card/ordem-info-card';
import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityExam, QualityExamComponent } from '../../models/quality-exam';
import { QualityControlService } from '../../services/quality-control';
import { OperatorService } from '../../../shop-floor/services/operator';

@Component({
  selector: 'app-quality-control-home',
  imports: [OrdemInfoCard, PoButtonModule, PoPageModule, PoProgressModule, PoWidgetModule],
  templateUrl: './quality-control-home.html',
  styleUrls: ['./quality-control-home.css'],
})
export class QualityControlHome {
  productionOrderRoute?: ProductionOrderRoute;
  qualityExams: QualityExam[] = [];
  selectedComponent?: QualityExamComponent;
  feedback = '';
  isLoadingComponents = false;
  isRegisteringResult = false;

  constructor(
    private readonly qualityControlService: QualityControlService,
    private readonly operatorService: OperatorService,
    private readonly router?: Router,
  ) {
    this.loadGeneratedRouteFromNavigation();
  }

  get operatorId(): string {
    return this.operatorService.selectedOperator?.code ?? '';
  }

  get components(): QualityExamComponent[] {
    return this.qualityExams.flatMap(exam => exam.components).sort((a, b) => a.sequence - b.sequence);
  }

  get completedComponentsCount(): number {
    return this.components.filter(component => this.isComponentCompleted(component)).length;
  }

  get pendingComponentsCount(): number {
    return this.components.length - this.completedComponentsCount;
  }

  get progressPercentage(): number {
    if (this.components.length === 0) {
      return 0;
    }

    return Math.round((this.completedComponentsCount / this.components.length) * 100);
  }

  get progressText(): string {
    return `${this.completedComponentsCount} de ${this.components.length} componentes concluídos`;
  }

  get currentExam(): QualityExam | undefined {
    return this.qualityExams[0];
  }

  get selectedExam(): QualityExam | undefined {
    if (!this.selectedComponent) {
      return this.currentExam;
    }

    return this.qualityExams.find(exam =>
      exam.components.some(component => component.id === this.selectedComponent?.id),
    );
  }

  get canRegisterResult(): boolean {
    return Boolean(
      this.productionOrderRoute &&
        this.currentExam &&
        this.selectedComponent &&
        this.selectedComponent.status !== 'APPROVED' &&
        this.selectedComponent.status !== 'REJECTED' &&
        !this.isLoadingComponents &&
        !this.isRegisteringResult,
    );
  }

  get canOpenExamEntry(): boolean {
    return this.canRegisterResult;
  }

  get isInspectionFinished(): boolean {
    return this.components.length > 0 && this.pendingComponentsCount === 0;
  }

  get canSaveInspection(): boolean {
    if (!this.productionOrderRoute || this.qualityExams.length === 0) {
      return false;
    }

    if (this.operatorService.isOperatorRequired() && this.operatorService.selectedOperator === null) {
      return false;
    }

    return this.isInspectionFinished;
  }

  get saveBlockReason(): string {
    if (!this.productionOrderRoute || this.qualityExams.length === 0) {
      return 'Gere o roteiro e carregue os componentes antes de salvar.';
    }

    if (!this.isInspectionFinished) {
      return 'Registre todos os componentes antes de encerrar a inspeção.';
    }

    if (this.operatorService.isOperatorRequired() && this.operatorService.selectedOperator === null) {
      return 'Selecione o operador ativo antes de salvar.';
    }

    return '';
  }

  private loadGeneratedRouteFromNavigation(): void {
    const state = this.router?.getCurrentNavigation()?.extras.state;
    const route = state?.['productionOrderRoute'] as ProductionOrderRoute | undefined;
    const qualityExams = state?.['qualityExams'] as QualityExam[] | undefined;

    if (!route) {
      this.feedback = 'Gere o roteiro antes de iniciar a inspeção de processo.';
      void this.router?.navigate(['/quality-control']);
      return;
    }

    this.productionOrderRoute = route;

    if (qualityExams) {
      this.qualityExams = this.orderExams(qualityExams);
      this.selectedComponent = this.components.find(component => component.status === 'PENDING' || component.status === 'IN_PROGRESS');
      this.feedback = 'Medições do exame restauradas.';
      return;
    }

    this.loadQualityExams(route);
  }

  private loadQualityExams(route: ProductionOrderRoute): void {
    this.isLoadingComponents = true;
    this.feedback = 'Carregando componentes do roteiro no Datasul...';

    this.qualityControlService.getQualityExams(route.itemCode, route.operationCode).subscribe({
      next: exams => {
        this.qualityExams = this.orderExams(exams);
        this.selectedComponent = this.components.find(component => component.status === 'PENDING');
        this.isLoadingComponents = false;
        this.feedback = this.components.length
          ? 'Componentes carregados. Inicie pelo componente destacado.'
          : 'Nenhum componente retornado para o roteiro.';
      },
      error: () => {
        this.qualityExams = [];
        this.selectedComponent = undefined;
        this.isLoadingComponents = false;
        this.feedback = 'Nao foi possivel carregar os componentes do roteiro.';
      },
    });
  }

  selectComponent(component: QualityExamComponent): void {
    if (this.isRegisteringResult || this.isLoadingComponents) {
      return;
    }

    const nextOpenComponent = this.components.find(item => item.status === 'PENDING' || item.status === 'IN_PROGRESS');

    if (nextOpenComponent && nextOpenComponent.id !== component.id) {
      this.feedback = 'Siga a sequência do roteiro definida pelo Datasul.';
      return;
    }

    this.selectedComponent = component;

    if (component.status === 'PENDING') {
      component.status = 'IN_PROGRESS';
    }

    this.feedback = `${component.code} selecionado para inspeção.`;
  }

  approveSelectedComponent(): void {
    this.registerSelectedComponentResult('APPROVED');
  }

  rejectSelectedComponent(): void {
    this.registerSelectedComponentResult('REJECTED');
  }

  openExamEntry(): void {
    if (!this.canOpenExamEntry || !this.productionOrderRoute || !this.selectedExam || !this.selectedComponent) {
      return;
    }

    void this.router?.navigate(['/quality-control/exam-entry'], {
      state: {
        productionOrderRoute: this.productionOrderRoute,
        qualityExams: this.qualityExams,
        exam: this.selectedExam,
        componentId: this.selectedComponent.id,
      },
    });
  }

  private orderExams(exams: QualityExam[]): QualityExam[] {
    return exams.map(exam => ({
      ...exam,
      components: [...exam.components].sort((a, b) => a.sequence - b.sequence),
    }));
  }

  private registerSelectedComponentResult(result: 'APPROVED' | 'REJECTED'): void {
    if (!this.canRegisterResult || !this.productionOrderRoute || !this.currentExam || !this.selectedComponent) {
      return;
    }

    const component = this.selectedComponent;
    this.isRegisteringResult = true;
    this.feedback = result === 'APPROVED' ? 'Registrando aprovação no Datasul...' : 'Registrando reprovação no Datasul...';

    this.qualityControlService
      .registerComponentResult({
        routeNumber: this.productionOrderRoute.routeNumber,
        examId: this.currentExam.id,
        componentId: component.id,
        result,
        operatorId: this.operatorId,
      })
      .subscribe({
        next: response => {
          component.status = response.status;
          component.inspectedAt = response.inspectedAt;
          component.operatorId = response.operatorId;
          this.isRegisteringResult = false;
          this.selectNextPendingComponent();
          this.feedback = this.isInspectionFinished
            ? 'Inspeção concluída. Todos os componentes foram registrados.'
            : 'Resultado registrado. Próximo componente selecionado.';
        },
        error: () => {
          this.isRegisteringResult = false;
          this.feedback = 'Nao foi possivel registrar o resultado. Tente novamente.';
        },
      });
  }

  private selectNextPendingComponent(): void {
    const nextComponent = this.components.find(component => component.status === 'PENDING');

    if (!nextComponent) {
      return;
    }

    nextComponent.status = 'IN_PROGRESS';
    this.selectedComponent = nextComponent;
  }

  goBack(): void {
    if (!this.isRegisteringResult) {
      void this.router?.navigate(['/quality-control']);
    }
  }

  exit(): void {
    if (!this.isRegisteringResult) {
      void this.router?.navigate(['/menu']);
    }
  }

  isSelected(component: QualityExamComponent): boolean {
    return this.selectedComponent?.id === component.id;
  }

  isComponentCompleted(component: QualityExamComponent): boolean {
    return component.status === 'APPROVED' || component.status === 'REJECTED';
  }

  statusLabel(component: QualityExamComponent): string {
    const labels = {
      PENDING: 'Pendente',
      IN_PROGRESS: 'Em inspeção',
      APPROVED: 'Aprovado',
      REJECTED: 'Reprovado',
    };

    return labels[component.status];
  }
}
