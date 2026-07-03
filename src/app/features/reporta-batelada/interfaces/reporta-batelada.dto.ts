export interface BatchReportItemRequest {
  readonly opId: string;
  readonly opNumber: string;
  readonly orderNumber: string;
  readonly quantity: number;
}

export interface StartBatchRequest {
  readonly batchId: string;
  readonly itemIds: ReadonlyArray<string>;
  readonly dataInicio: Date;
  readonly horaInicio: string;
  readonly operatorId: string;
  readonly workCenter: string;
}

export interface ReportBatchRequest {
  readonly batchId: string;
  readonly items: ReadonlyArray<BatchReportItemRequest>;
  readonly quantidadeRefugo: number;
  readonly quantidadeRetrabalho: number;
  readonly dataInicio: Date;
  readonly horaInicio: string;
  readonly dataFim: Date;
  readonly horaFim: string;
  readonly operatorId: string;
  readonly workCenter: string;
}
