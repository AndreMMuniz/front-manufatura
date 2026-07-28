import {
  ProductionContextOrigin,
  ResponsavelParada,
} from '../models/reporte-paradas.model';

export interface CreateStopRequest {
  readonly areaCode: string;
  readonly workCenterCode: string;
  readonly reasonId: number;
  readonly responsible: ResponsavelParada;
  readonly startDate: Date | string;
  readonly startTime: string;
  readonly endDate?: Date | string | null;
  readonly endTime?: string | null;
  readonly programmed: boolean;
  readonly origin?: ProductionContextOrigin;
  readonly idempotencyKey: string;
}

export interface StopResponse {
  readonly id: number;
  readonly idempotencyKey: string;
  readonly status: 'EM_ANDAMENTO' | 'FINALIZADA';
  readonly syncStatus: 'PENDING' | 'SYNCED' | 'ERROR';
  readonly durationMinutes?: number;
}

export interface FinishStopRequest {
  readonly endDate: Date | string;
  readonly endTime: string;
  readonly idempotencyKey: string;
}
