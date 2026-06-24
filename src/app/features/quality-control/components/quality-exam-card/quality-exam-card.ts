import { Component, input, output } from '@angular/core';

import { PoButtonModule, PoWidgetModule } from '@po-ui/ng-components';

import { QualityExam, QualityExamComponent } from '../../models/quality-exam';

@Component({
  selector: 'app-quality-exam-card',
  imports: [PoButtonModule, PoWidgetModule],
  templateUrl: './quality-exam-card.html',
  styleUrls: ['./quality-exam-card.css'],
})
export class QualityExamCard {
  readonly exam = input.required<QualityExam>();
  readonly componentSelected = output<QualityExamComponent>();

  selectComponent(component: QualityExamComponent): void {
    this.componentSelected.emit(component);
  }
}
