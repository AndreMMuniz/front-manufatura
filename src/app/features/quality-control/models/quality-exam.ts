export type QualityComponentStatus = 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
export type QualityMeasurementStatus = 'RECORDED' | 'APPROVED' | 'REJECTED';

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
  measurementMethod?: string;
  equipment?: string;
  inspectionMethod?: string;
  minValue: number;
  maxValue: number;
  unit: string;
  sequence: number;
  examCode?: number;
  componentCode?: number;
  tableNumber?: number;
  resultType?: number;
  decimalPlaces?: number;
  resultOptions?: readonly QualityResultOption[];
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
  sample: string;
  unit: string;
  nqa: string;
  level: string;
  responsible?: string;
  observation?: string;
  components: QualityExamComponent[];
}

export interface QualityMeasurement {
  result?: number;
  maximumResult?: number;
  report?: string;
  selectedOption?: QualityResultOption;
  observation?: string;
  status: QualityMeasurementStatus;
  savedAt?: Date;
  operatorId?: string;
  commandId?: string;
  deliveryStatus?: 'PENDING' | 'SYNCED' | 'ERROR';
  withinRange?: boolean;
}

export interface QualityResultOption {
  readonly tableNumber: number;
  readonly sequence: number;
  readonly description: string;
}
