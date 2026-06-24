export type QualityComponentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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
  measuredValue?: number;
  observation?: string;
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
