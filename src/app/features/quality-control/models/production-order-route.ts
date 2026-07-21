export interface ProductionOrderOperation {
  operationCode: string;
  operationDescription: string;
  split?: string;
  itemCode: string;
  itemDescription: string;
  processDescription: string;
}

export interface ProductionOrderOperationsResult {
  orderNumber: string;
  operations: ProductionOrderOperation[];
}

export interface GenerateInspectionRouteRequest {
  orderNumber: string;
  operation: ProductionOrderOperation;
  moveBalance: boolean;
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
