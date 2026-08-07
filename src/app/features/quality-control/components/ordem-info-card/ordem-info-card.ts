import { Component, Input } from '@angular/core';

import { ProductionOrderRoute } from '../../models/production-order-route';

@Component({
  selector: 'app-ordem-info-card',
  templateUrl: './ordem-info-card.html',
  styleUrls: ['./ordem-info-card.css'],
})
export class OrdemInfoCard {
  @Input() route?: ProductionOrderRoute;
}
