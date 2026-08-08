import type { QualityExam } from './quality-exam';

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
  idempotencyKey?: string;
}

export interface ProductionOrderRoute {
  nrFicha?: number;
  localId?: string;
  creationCommandId?: string;
  routeNumber: string;
  processDescription: string;
  currentOrder: string;
  operationCode: string;
  operationDescription: string;
  split: string;
  itemCode: string;
  itemDescription: string;
  exams?: readonly QualityExam[];
}
