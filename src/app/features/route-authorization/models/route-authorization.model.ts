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
  readonly componentResults: readonly PendingAuthorizedComponentResult[];
}

export interface PendingAuthorizedComponentResult {
  readonly sheetNumber: number;
  readonly examCode: number;
  readonly componentCode: number;
  readonly componentSequence: number;
  readonly resultType: number;
  readonly result: number;
  readonly report: string;
  readonly tableNumber: number;
  readonly withinRange: boolean;
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

export interface AuthorizedRouteFinalizationRefusal {
  readonly sheetNumber: number;
  readonly finalized: false;
  readonly inspected: boolean;
  readonly totalComponents: number;
  readonly savedComponents: number;
  readonly pendingComponents: number;
  readonly outOfRangeComponents: number;
  readonly statusCode: number;
  readonly message: string;
  readonly exams: readonly AuthorizedRouteExamSummary[];
}

export type AuthorizedRouteFinalizationOutcome = AuthorizedRouteFinalization | AuthorizedRouteFinalizationRefusal;

export type AuthorizedComponentResultRequest =
  | { readonly kind: 'numeric'; readonly result: number }
  | { readonly kind: 'table'; readonly tableNumber: number; readonly optionSequence: number }
  | { readonly kind: 'report'; readonly report: string };

export interface AuthorizedComponentSaveResult {
  readonly sheetNumber: number;
  readonly examCode: number;
  readonly componentCode: number;
  readonly withinRange: boolean;
  readonly savedComponents: number;
  readonly totalComponents: number;
}

export interface AuthorizedRouteExamSummary {
  readonly examCode: number;
  readonly totalComponents: number;
  readonly savedComponents: number;
  readonly pendingComponents: number;
}
