import { Component, input } from '@angular/core';

import { ProductionOrderRoute } from '../../models/production-order-route';

@Component({
  selector: 'app-route-summary',
  templateUrl: './route-summary.html',
  styleUrls: ['./route-summary.css'],
})
export class RouteSummary {
  readonly route = input.required<ProductionOrderRoute>();
}
