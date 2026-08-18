export interface PendingAuthorizedRoute {
  readonly sheetNumber: number;
  readonly productionOrderNumber: number;
  readonly itemCode: string;
  readonly itemDescription: string;
  readonly operationSequence: number;
  readonly statusCode: number;
  readonly released: boolean;
  readonly inspected: boolean;
  readonly totalComponents: number;
  readonly outOfRangeComponents: number;
  readonly narrative: string;
}

export interface AuthorizedRouteFinalization {
  readonly sheetNumber: number;
  readonly finalized: true;
  readonly inspected: boolean;
  readonly totalComponents: number;
  readonly savedComponents: number;
  readonly pendingComponents: 0;
  readonly outOfRangeComponents: number;
  readonly statusCode: number;
  readonly message: string;
  readonly exams: readonly AuthorizedRouteExamSummary[];
}

export interface AuthorizedRouteExamSummary {
  readonly examCode: number;
  readonly totalComponents: number;
  readonly savedComponents: number;
  readonly pendingComponents: number;
}
