import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PoButtonModule, PoFieldModule, PoPageModule, PoWidgetModule } from '@po-ui/ng-components';

import { MeasurementEntryForm } from '../../components/measurement-entry-form/measurement-entry-form';
import { QualityExamCard } from '../../components/quality-exam-card/quality-exam-card';
import { ReactionPlanAuthorizationForm } from '../../components/reaction-plan-authorization-form/reaction-plan-authorization-form';
import { RouteLookupForm } from '../../components/route-lookup-form/route-lookup-form';
import { RouteSummary } from '../../components/route-summary/route-summary';
import { SaveInspectionActions } from '../../components/save-inspection-actions/save-inspection-actions';
import { ProductionOrderRoute } from '../../models/production-order-route';
import { QualityExam, QualityExamComponent } from '../../models/quality-exam';
import { QualityControlService } from '../../services/quality-control';
import { OperatorService } from '../../../shop-floor/services/operator';

@Component({
  selector: 'app-quality-control-home',
  imports: [
    FormsModule,
    MeasurementEntryForm,
    QualityExamCard,
    ReactionPlanAuthorizationForm,
    RouteLookupForm,
    RouteSummary,
    SaveInspectionActions,
    PoButtonModule,
    PoFieldModule,
    PoPageModule,
    PoWidgetModule,
  ],
  templateUrl: './quality-control-home.html',
  styleUrls: ['./quality-control-home.css'],
})
export class QualityControlHome {
  opNumber = '';
  operationCode = '';
  split = '';
  productionOrderRoute?: ProductionOrderRoute;
  qualityExams: QualityExam[] = [];
  selectedComponent?: QualityExamComponent;
  measuredValue = '';
  measurementObservation = '';
  measurementFeedback = '';
  supervisorId = '';
  supervisorPassword = '';
  authorizationReason = 'Plano de reacao aplicado para continuidade do processo.';
  authorizationFeedback = '';
  saveFeedback = '';

  constructor(
    private readonly qualityControlService: QualityControlService,
    private readonly operatorService: OperatorService,
  ) {}

  get operatorId(): string {
    return this.operatorService.selectedOperator?.code ?? '';
  }

  get canGenerateRoute(): boolean {
    return Boolean(this.opNumber.trim() && this.operationCode.trim());
  }

  generateRoute(): void {
    if (!this.canGenerateRoute) {
      return;
    }

    this.qualityControlService
      .getProductionOrderRoute({
        opNumber: this.opNumber.trim(),
        operationCode: this.operationCode.trim(),
        split: this.split.trim(),
      })
      .subscribe(route => {
        this.productionOrderRoute = route;
        this.loadQualityExams(route);
      });
  }

  private loadQualityExams(route: ProductionOrderRoute): void {
    this.qualityControlService.getQualityExams(route.itemCode, route.operationCode).subscribe(exams => {
      this.qualityExams = exams;
      this.selectedComponent = undefined;
      this.measuredValue = '';
      this.measurementObservation = '';
      this.measurementFeedback = '';
      this.resetAuthorizationForm();
      this.saveFeedback = '';
    });
  }

  selectComponent(component: QualityExamComponent): void {
    this.selectedComponent = component;
    this.measuredValue = component.measuredValue?.toString() ?? '';
    this.measurementObservation = component.observation ?? '';
    this.measurementFeedback = '';
    this.resetAuthorizationForm();
  }

  saveMeasurement(): void {
    if (!this.selectedComponent || !this.measuredValue.trim()) {
      return;
    }

    const measuredValue = Number(this.measuredValue.replace(',', '.'));

    if (Number.isNaN(measuredValue)) {
      this.measurementFeedback = 'Informe um valor numerico valido.';
      return;
    }

    this.selectedComponent.measuredValue = measuredValue;
    this.selectedComponent.observation = this.measurementObservation.trim();
    this.selectedComponent.status = this.qualityControlService.validateMeasurement(
      this.selectedComponent,
      measuredValue,
    );
    this.measurementFeedback =
      this.selectedComponent.status === 'APPROVED'
        ? 'Medicao aprovada dentro da tolerancia.'
        : 'Medicao reprovada: valor fora da tolerancia.';

    if (this.selectedComponent.status === 'APPROVED') {
      this.selectedComponent.authorization = undefined;
      this.resetAuthorizationForm();
    }
  }

  get requiresAuthorization(): boolean {
    return this.selectedComponent?.status === 'REJECTED' && !this.selectedComponent.authorization;
  }

  get canAuthorizeReactionPlan(): boolean {
    return Boolean(this.supervisorId.trim() && this.supervisorPassword.trim() && this.authorizationReason.trim());
  }

  authorizeReactionPlan(): void {
    if (!this.selectedComponent || !this.canAuthorizeReactionPlan) {
      return;
    }

    this.qualityControlService
      .authorizeReactionPlan({
        componentId: this.selectedComponent.id,
        supervisorId: this.supervisorId.trim(),
        password: this.supervisorPassword.trim(),
        reason: this.authorizationReason.trim(),
      })
      .subscribe(authorization => {
        if (!this.selectedComponent) {
          return;
        }

        this.selectedComponent.authorization = {
          supervisorId: authorization.supervisorId,
          reason: authorization.reason,
          approvedAt: authorization.approvedAt,
        };
        this.authorizationFeedback = 'Plano de reacao autorizado pelo supervisor.';
        this.supervisorPassword = '';
      });
  }

  get canSaveInspection(): boolean {
    if (!this.productionOrderRoute || this.qualityExams.length === 0) {
      return false;
    }

    if (this.operatorService.isOperatorRequired() && this.operatorService.selectedOperator === null) {
      return false;
    }

    const components = this.qualityExams.flatMap(exam => exam.components);
    const hasPending = components.some(component => component.status === 'PENDING');
    const hasUnauthorizedRejected = components.some(
      component => component.status === 'REJECTED' && !component.authorization,
    );

    return !hasPending && !hasUnauthorizedRejected;
  }

  get saveBlockReason(): string {
    if (!this.productionOrderRoute || this.qualityExams.length === 0) {
      return 'Gere o roteiro e carregue os exames antes de salvar.';
    }

    const components = this.qualityExams.flatMap(exam => exam.components);

    if (components.some(component => component.status === 'PENDING')) {
      return 'Conclua todas as medicoes antes de salvar.';
    }

    if (components.some(component => component.status === 'REJECTED' && !component.authorization)) {
      return 'Autorize o plano de reacao para componentes reprovados antes de salvar.';
    }

    if (this.operatorService.isOperatorRequired() && this.operatorService.selectedOperator === null) {
      return 'Selecione o operador ativo antes de salvar.';
    }

    return '';
  }

  saveInspection(): void {
    if (!this.canSaveInspection || !this.productionOrderRoute) {
      this.saveFeedback = this.saveBlockReason;
      return;
    }

    const exam = this.qualityExams[0];
    const hasRejected = exam.components.some(component => component.status === 'REJECTED');

    this.qualityControlService
      .saveInspection({
        opNumber: this.productionOrderRoute.currentOrder,
        operationCode: this.productionOrderRoute.operationCode,
        split: this.productionOrderRoute.split,
        routeNumber: this.productionOrderRoute.routeNumber,
        itemCode: this.productionOrderRoute.itemCode,
        itemDescription: this.productionOrderRoute.itemDescription,
        examId: exam.id,
        examCode: exam.code,
        examVersion: exam.version,
        operatorId: this.operatorId,
        status: hasRejected ? 'REJECTED' : 'APPROVED',
        createdAt: new Date(),
        measurements: exam.components.map(component => ({
          componentId: component.id,
          componentCode: component.code,
          description: component.description,
          measuredValue: component.measuredValue ?? 0,
          expectedMin: component.minValue,
          expectedMax: component.maxValue,
          unit: component.unit,
          status: component.status,
          observation: component.observation,
          authorization: component.authorization,
        })),
      })
      .subscribe(result => {
        this.saveFeedback = `Inspecao ${result.inspectionId} salva em ${result.savedAt.toLocaleString()}.`;
      });
  }

  private resetAuthorizationForm(): void {
    this.supervisorId = '';
    this.supervisorPassword = '';
    this.authorizationReason = 'Plano de reacao aplicado para continuidade do processo.';
    this.authorizationFeedback = '';
  }
}
