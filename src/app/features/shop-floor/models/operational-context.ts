import { Operator } from './operator';
import { WorkCenter } from './work-center';

export type ReportType = 'OPERATOR' | 'BATCH';

export interface OperationalContext {
  readonly workCenter: WorkCenter;
  readonly operator: Operator;
  readonly reportType: ReportType;
  readonly validity: string;
}
