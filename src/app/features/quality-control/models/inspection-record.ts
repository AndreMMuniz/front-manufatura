import { QualityComponentStatus } from './quality-exam';

export interface InspectionMeasurementPayload {
  componentId: string;
  componentCode: string;
  description: string;
  measuredValue: number;
  expectedMin: number;
  expectedMax: number;
  unit: string;
  status: QualityComponentStatus;
  observation?: string;
  authorization?: {
    supervisorId: string;
    reason: string;
    approvedAt: Date;
  };
}

export interface SaveInspectionPayload {
  opNumber: string;
  operationCode: string;
  split: string;
  routeNumber: string;
  itemCode: string;
  itemDescription: string;
  examId: string;
  examCode: string;
  examVersion: string;
  operatorId: string;
  status: 'APPROVED' | 'REJECTED';
  createdAt: Date;
  measurements: InspectionMeasurementPayload[];
}

export interface SaveInspectionResult {
  inspectionId: string;
  savedAt: Date;
}
