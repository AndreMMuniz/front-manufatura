import { ResponsavelOperacional, TipoResponsavelOperacional } from '../../shop-floor/models/operational-responsible';
import { AreaProducao } from '../../shop-floor/models/production-area';
import { WorkCenter } from '../../shop-floor/models/work-center';

export interface StopReason {
  readonly id: number;
  readonly code: string;
  readonly description: string;
}

export type ResponsavelParada = ResponsavelOperacional;
export type TipoResponsavelParada = TipoResponsavelOperacional;

export type ProductionContextOriginType = 'OPERATION_REPORT' | 'BATCH_REPORT';

export interface ProductionContextOrigin {
  readonly type: ProductionContextOriginType;
  readonly sourceRoute: '/operation-reporting' | '/batch-reporting';
  readonly reportId?: string;
  readonly batchId?: string;
}

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
export type ParadaSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';

export interface StopEntry {
  readonly id: number;
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
