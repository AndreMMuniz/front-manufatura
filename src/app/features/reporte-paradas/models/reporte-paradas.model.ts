export interface StopReason {
  readonly id: number;
  readonly code: string;
  readonly description: string;
}

export interface ProductionContext {
  readonly workCenter: string;
  readonly machineGroup: string;
  readonly operatorName: string;
  readonly team: string;
  readonly shift: string;
  readonly reportId: string;
  readonly sourceRoute: string;
}

export interface StopEntry {
  readonly id: number;
  readonly reason: StopReason;
  readonly startDate: Date;
  readonly startTime: string;
  readonly endDate?: Date;
  readonly endTime: string;
  readonly programmed: boolean;
}

export interface StopSaveResult {
  readonly protocol: string;
  readonly savedAt: Date;
}
