import { JsonValue } from './local-record';

export const OPERATIONAL_COMMAND_TYPES = [
  'GENERATE_INSPECTION_ROUTE',
  'SAVE_MEASUREMENT',
  'FINISH_EXAM',
  'STOP_INSPECTION_ROUTE',
  'SAVE_INSPECTION',
  'START_OPERATION',
  'REPORT_OPERATION',
  'END_OPERATION',
  'START_BATCH',
  'REPORT_BATCH',
  'END_BATCH',
  'CREATE_STOP',
  'FINISH_STOP',
] as const;

export type OperationalCommandType = (typeof OPERATIONAL_COMMAND_TYPES)[number];

export type OperationalAggregateType =
  | 'QUALITY_ROUTE'
  | 'QUALITY_EXAM'
  | 'QUALITY_INSPECTION'
  | 'OPERATION'
  | 'BATCH'
  | 'STOP';

export interface OperationalCommandDefinition {
  readonly aggregateType: OperationalAggregateType;
  readonly payloadSchemaVersion: number;
}

export const OPERATIONAL_COMMAND_DEFINITIONS = Object.freeze({
  GENERATE_INSPECTION_ROUTE: definition('QUALITY_ROUTE'),
  SAVE_MEASUREMENT: definition('QUALITY_EXAM'),
  FINISH_EXAM: definition('QUALITY_EXAM'),
  STOP_INSPECTION_ROUTE: definition('QUALITY_ROUTE'),
  SAVE_INSPECTION: definition('QUALITY_INSPECTION'),
  START_OPERATION: definition('OPERATION'),
  REPORT_OPERATION: definition('OPERATION'),
  END_OPERATION: definition('OPERATION'),
  START_BATCH: definition('BATCH'),
  REPORT_BATCH: definition('BATCH'),
  END_BATCH: definition('BATCH'),
  CREATE_STOP: definition('STOP'),
  FINISH_STOP: definition('STOP'),
} satisfies Record<OperationalCommandType, OperationalCommandDefinition>);

export type InitialOperationalSyncStatus = 'PENDING' | 'BLOCKED_AUTH';

export interface CaptureOperationalCommandRequest<
  TCommandType extends OperationalCommandType = OperationalCommandType,
  TPayload extends JsonValue = JsonValue,
> {
  readonly commandType: TCommandType;
  readonly aggregateId: string;
  readonly payload: TPayload;
  readonly businessStatus: string;
  readonly idempotencyKey?: string;
  readonly occurredAt?: string;
  readonly dependencyIds?: readonly string[];
  readonly initialSyncStatus?: InitialOperationalSyncStatus;
}

export interface LocalCommandConfirmation {
  readonly localId: string;
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly committedAt: string;
  readonly syncStatus: InitialOperationalSyncStatus;
}

function definition(aggregateType: OperationalAggregateType): OperationalCommandDefinition {
  return Object.freeze({ aggregateType, payloadSchemaVersion: 1 });
}
