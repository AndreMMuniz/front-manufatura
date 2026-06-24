export interface ProductionOrderRouteRequest {
  opNumber: string;
  operationCode: string;
  split?: string;
}

export interface ProductionOrderRoute {
  routeNumber: string;
  processDescription: string;
  currentOrder: string;
  operationCode: string;
  operationDescription: string;
  split: string;
  itemCode: string;
  itemDescription: string;
}
