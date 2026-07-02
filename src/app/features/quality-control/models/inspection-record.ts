import { QualityComponentStatus, QualityMeasurement } from './quality-exam';

export interface RegisterComponentResultRequest {
  routeNumber: string;
  examId: string;
  componentId: string;
  result: Extract<QualityComponentStatus, 'APPROVED' | 'REJECTED'>;
  operatorId: string;
}

export interface RegisterComponentResultResponse {
  componentId: string;
  status: Extract<QualityComponentStatus, 'APPROVED' | 'REJECTED'>;
  inspectedAt: Date;
  operatorId: string;
}

export type MeasurementValidationFailureReason =
  | 'REQUIRED'
  | 'INVALID_NUMBER'
  | 'INVALID_RANGE'
  | 'OUT_OF_RANGE';

export type MeasurementValidationResult =
  | {
      valid: true;
      status: Extract<QualityComponentStatus, 'APPROVED'>;
    }
  | {
      valid: false;
      reason: MeasurementValidationFailureReason;
      message: string;
    };

export interface SaveMeasurementRequest {
  examId: string;
  componentId: string;
  measurement: QualityMeasurement;
  operatorId: string;
}

export interface SaveMeasurementResponse {
  componentId: string;
  measurement: QualityMeasurement;
}

export interface InspectionMeasurementPayload {
  componentId: string;
  componentCode: string;
  description: string;
  measuredValue?: number;
  measuredMinimum?: number;
  measuredMaximum?: number;
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
