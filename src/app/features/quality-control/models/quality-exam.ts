export type QualityComponentStatus = 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
export type QualityMeasurementStatus = Extract<QualityComponentStatus, 'APPROVED' | 'REJECTED'>;

export interface QualityComponentAuthorization {
  supervisorId: string;
  reason: string;
  approvedAt: Date;
}

export interface QualityExamComponent {
  id: string;
  code: string;
  description: string;
  reference: string;
  minValue: number;
  maxValue: number;
  unit: string;
  sequence: number;
  status: QualityComponentStatus;
  inspectedAt?: Date;
  operatorId?: string;
  measuredValue?: number;
  observation?: string;
  measurement?: QualityMeasurement;
  authorization?: QualityComponentAuthorization;
}

export interface QualityExam {
  id: string;
  code: string;
  description: string;
  version: string;
  frequency: string;
  unit: string;
  nqa: string;
  level: string;
  responsible?: string;
  components: QualityExamComponent[];
}

export interface QualityMeasurement {
  minimum: number;
  maximum: number;
  observation?: string;
  status: QualityMeasurementStatus;
  savedAt?: Date;
  operatorId?: string;
}
