import {
  AuthorizedRouteFinalization,
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
): AuthorizedRouteFinalization {
  const envelope = envelopeOf(value);
  const matches = envelope.items.flatMap(item => {
    const resultValue = objectOf(item)['ds-finaliza'];
    if (resultValue === undefined) return [];
    return optionalArrayOf(objectOf(resultValue)['roteiro']).map(objectOf);
  }).filter(route => route['nrFicha'] === expectedSheetNumber);
  const route = matches.length === 1 ? matches[0] : undefined;
  if (!route || route['finalizado'] !== true || route['componentesPendentes'] !== 0) {
    throw new Error('route-authorization-not-completed');
  }
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
  const outOfRangeComponents = nonNegativeIntegerOf(route['componentesForaFaixa']);
  if (
    savedComponents !== totalComponents
    || outOfRangeComponents > totalComponents
    || exams.some(exam => exam.pendingComponents !== 0
      || exam.savedComponents !== exam.totalComponents)
  ) throw invalidContract();
  return {
    sheetNumber: positiveIntegerOf(route['nrFicha']),
    finalized: true,
    inspected: booleanOf(route['inspecionado']),
    totalComponents,
    savedComponents,
    pendingComponents: 0,
    outOfRangeComponents,
    statusCode: nonNegativeIntegerOf(route['situacao']),
    message: textOf(route['mensagem'], false),
    exams,
  };
}

function envelopeOf(value: unknown): { readonly items: readonly unknown[] } {
  const envelope = objectOf(value);
  nonNegativeIntegerOf(envelope['total']);
  if (booleanOf(envelope['hasNext'])) throw invalidContract();
  return { items: optionalArrayOf(envelope['items']) };
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
