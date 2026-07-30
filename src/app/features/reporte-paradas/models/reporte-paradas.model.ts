import {
  ResponsavelOperacional,
  TipoResponsavelOperacional,
} from '../../shop-floor/models/operational-responsible';
import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';

export interface StopReason {
  readonly id: number;
  readonly code: string;
  readonly description: string;
}

export type ResponsavelParada = ResponsavelOperacional;
export type TipoResponsavelParada = TipoResponsavelOperacional;

export type ProductionContextOrigin =
  | {
      readonly type: 'OPERATION_REPORT';
      readonly sourceRoute: '/operation-reporting';
      readonly reportId: string;
      readonly batchId?: never;
    }
  | {
      readonly type: 'BATCH_REPORT';
      readonly sourceRoute: '/batch-reporting';
      readonly batchId: string;
      readonly reportId?: never;
    };

export type ProductionContextOriginType = ProductionContextOrigin['type'];

export interface ProductionContext {
  readonly area: AreaProducao;
  readonly workCenter: WorkCenter;
  readonly origin?: ProductionContextOrigin;
  readonly preferredResponsible?: ResponsavelParada;
  readonly metadata?: {
    readonly shift?: string;
    readonly machineGroup?: string;
    readonly orderIds?: ReadonlyArray<string>;
  };
}

export type ParadaStatus = 'EM_ANDAMENTO' | 'FINALIZADA';
export type ParadaSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'BLOCKED_AUTH' | 'ERROR';
export type StopId = string | number;

export interface StopEntry {
  readonly id: StopId;
  readonly localId?: string;
  readonly creationCommandId?: string;
  readonly finishCommandId?: string;
  readonly context: ProductionContext;
  readonly reason: StopReason;
  readonly responsible: ResponsavelParada;
  readonly startDate: Date;
  readonly startTime: string;
  readonly endDate?: Date;
  readonly endTime?: string;
  readonly programmed: boolean;
  readonly status: ParadaStatus;
  readonly durationMinutes?: number;
  readonly idempotencyKey: string;
  readonly syncStatus: ParadaSyncStatus;
}

export type Parada = StopEntry;

export interface StopSaveResult {
  readonly protocol: string;
  readonly savedAt: Date;
}
