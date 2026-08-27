import type { QualityExam } from './quality-exam';

export interface ProductionOrderOperation {
  operationCode: string;
  operationDescription: string;
  responsibleType?: 'OPERADOR' | 'EQUIPE';
  split?: string;
  itemCode: string;
  itemDescription: string;
  processDescription: string;
}

export interface ProductionOrderOperationsResult {
  orderNumber: string;
  operations: ProductionOrderOperation[];
  routeHistory: ProductionOrderRouteHistoryItem[];
}

export interface ProductionOrderRouteHistoryItem {
  sheetNumber: string;
  orderNumber: string;
  operationCode: string;
  routeStatus: string;
  date: string | null;
  time: string;
}

export interface GenerateInspectionRouteRequest {
  orderNumber: string;
  operation: ProductionOrderOperation;
  responsibleType: 'OPERADOR' | 'EQUIPE';
  responsibleCode: string;
  moveBalance: boolean;
  idempotencyKey?: string;
}

export interface ProductionOrderRoute {
  nrFicha?: number;
  revisionCode?: string;
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
  responsibleType?: 'OPERADOR' | 'EQUIPE';
  responsibleCode?: string;
  exams?: readonly QualityExam[];
}
