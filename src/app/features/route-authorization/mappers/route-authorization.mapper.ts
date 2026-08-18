import {
  AuthorizedComponentSaveResult,
  AuthorizedRouteFinalizationOutcome,
  PendingAuthorizedRoute,
} from '../models/route-authorization.model';

export function mapPendingRoutesEnvelope(value: unknown): PendingAuthorizedRoute[] {
  const envelope = envelopeOf(value);
  const routes = envelope.items.flatMap(item => optionalArrayOf(objectOf(item)['roteirosEmAnalise']).map(routeValue => {
    const route = objectOf(routeValue);
    return {
      sheetNumber: positiveIntegerOf(route['nrFicha']),
      productionOrderNumber: positiveIntegerOf(route['nrOrdemProducao']),
      itemCode: textOf(route['codItem'], false),
      itemDescription: textOf(route['descricaoItem'], false),
      operationSequence: positiveIntegerOf(route['sequenciaOperacao']),
      statusCode: nonNegativeIntegerOf(route['situacao']),
      released: booleanOf(route['liberada']),
      inspected: booleanOf(route['inspecionado']),
      totalComponents: nonNegativeIntegerOf(route['componentesTotal']),
      outOfRangeComponents: nonNegativeIntegerOf(route['componentesForaFaixa']),
      narrative: textOf(route['narrativa'], true),
    };
  }));
  if (new Set(routes.map(route => route.sheetNumber)).size !== routes.length) throw invalidContract();
  return routes;
}

export function mapAuthorizedFinalizationEnvelope(
  value: unknown,
  expectedSheetNumber: number,
): AuthorizedRouteFinalizationOutcome {
  const envelope = envelopeOf(value);
  const matches = envelope.items.flatMap(item => {
    const resultValue = objectOf(item)['ds-finaliza'];
    if (resultValue === undefined) return [];
    return optionalArrayOf(objectOf(resultValue)['roteiro']).map(objectOf);
  }).filter(route => route['nrFicha'] === expectedSheetNumber);
  const route = matches.length === 1 ? matches[0] : undefined;
  if (!route) throw invalidContract();
  const exams = optionalArrayOf(route['exames']).map(value => {
    const exam = objectOf(value);
    if (positiveIntegerOf(exam['nrFicha']) !== expectedSheetNumber) throw invalidContract();
    return {
      examCode: positiveIntegerOf(exam['codExame']),
      totalComponents: nonNegativeIntegerOf(exam['componentesTotal']),
      savedComponents: nonNegativeIntegerOf(exam['componentesSalvos']),
      pendingComponents: nonNegativeIntegerOf(exam['componentesPendentes']),
    };
  });
  const totalComponents = nonNegativeIntegerOf(route['componentesTotal']);
  const savedComponents = nonNegativeIntegerOf(route['componentesSalvos']);
  const pendingComponents = nonNegativeIntegerOf(route['componentesPendentes']);
  const outOfRangeComponents = nonNegativeIntegerOf(route['componentesForaFaixa']);
  if (
    savedComponents + pendingComponents !== totalComponents
    || outOfRangeComponents > totalComponents
    || exams.some(exam => exam.savedComponents + exam.pendingComponents !== exam.totalComponents)
  ) throw invalidContract();
  const common = {
    sheetNumber: positiveIntegerOf(route['nrFicha']),
    inspected: booleanOf(route['inspecionado']),
    totalComponents,
    savedComponents,
    pendingComponents,
    outOfRangeComponents,
    statusCode: nonNegativeIntegerOf(route['situacao']),
    message: textOf(route['mensagem'], false),
    exams,
  } as const;
  if (route['finalizado'] === false) return { ...common, finalized: false };
  if (route['finalizado'] !== true || pendingComponents !== 0) throw invalidContract();
  return {
    ...common,
    finalized: true,
    pendingComponents: 0,
  };
}

export function mapAuthorizedComponentResultEnvelope(
  value: unknown,
  expectedSheetNumber: number,
  expectedExamCode: number,
  expectedComponentCode: number,
): AuthorizedComponentSaveResult {
  if (![expectedSheetNumber, expectedExamCode, expectedComponentCode].every(isPositiveInteger)) {
    throw invalidContract();
  }
  const envelope = resultEnvelopeOf(value);
  const item = objectOf(envelope.items[0]);
  const sheetNumber = positiveIntegerOf(item['nrFicha']);
  const examCode = positiveIntegerOf(item['codExame']);
  const componentCode = positiveIntegerOf(item['codComponente']);
  if (
    sheetNumber !== expectedSheetNumber
    || examCode !== expectedExamCode
    || componentCode !== expectedComponentCode
  ) throw invalidContract();
  const savedComponents = nonNegativeIntegerOf(item['componentesSalvos']);
  const totalComponents = nonNegativeIntegerOf(item['componentesTotal']);
  if (savedComponents > totalComponents) throw invalidContract();
  return {
    sheetNumber,
    examCode,
    componentCode,
    withinRange: booleanOf(item['dentroFaixa']),
    savedComponents,
    totalComponents,
  };
}

function envelopeOf(value: unknown): { readonly items: readonly unknown[] } {
  const envelope = objectOf(value);
  nonNegativeIntegerOf(envelope['total']);
  if (booleanOf(envelope['hasNext'])) throw invalidContract();
  return { items: optionalArrayOf(envelope['items']) };
}

function resultEnvelopeOf(value: unknown): { readonly items: readonly unknown[] } {
  const envelope = objectOf(value);
  if (envelope['total'] !== 1 || envelope['hasNext'] !== false) throw invalidContract();
  const items = arrayOf(envelope['items']);
  if (items.length !== 1) throw invalidContract();
  return { items };
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidContract();
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidContract();
  return value;
}

function optionalArrayOf(value: unknown): readonly unknown[] {
  return value === undefined ? [] : arrayOf(value);
}

function positiveIntegerOf(value: unknown): number {
  const result = nonNegativeIntegerOf(value);
  if (result === 0) throw invalidContract();
  return result;
}

function nonNegativeIntegerOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidContract();
  return value as number;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function booleanOf(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidContract();
  return value;
}

function textOf(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw invalidContract();
  return value;
}

function invalidContract(): Error {
  return new Error('invalid-upstream-response');
}
