export interface CreateStopRequest {
  readonly reportId: string;
  readonly reasonId: number;
  readonly startDate: Date;
  readonly startTime: string;
  readonly endDate?: Date;
  readonly endTime: string;
  readonly programmed: boolean;
}

export interface StopResponse {
  readonly id: number;
  readonly durationMinutes: number;
  readonly status: string;
}
