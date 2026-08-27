import {
  AuthorizedComponentSaveResult,
  AuthorizedRouteFinalizationOutcome,
  PendingAuthorizedComponentResult,
  PendingAuthorizedRoute,
} from '../models/route-authorization.model';

export function mapPendingRoutesEnvelope(value: unknown): PendingAuthorizedRoute[] {
  const envelope = envelopeOf(value);
  const routes = envelope.items.flatMap(item => {
    const container = objectOf(item);
    const dataset = container['ds-autorizacao'] === undefined ? container : objectOf(container['ds-autorizacao']);
    return optionalArrayOf(dataset['roteirosEmAnalise']).map(routeValue => {
      const route = objectOf(routeValue);
      const sheetNumber = positiveIntegerOf(route['nrFicha']);
      const totalComponents = nonNegativeIntegerOf(route['componentesTotal']);
      const declaredOutOfRangeComponents = nonNegativeIntegerOf(route['componentesForaFaixa']);
      if (declaredOutOfRangeComponents > totalComponents) throw invalidContract();
      const componentResults = arrayOf(route['resultados']).map(resultValue =>
        mapPendingComponentResult(resultValue, sheetNumber),
      );
      const outOfRangeComponents = componentResults.filter(result => result.withinRange === false).length;
      const componentIdentities = componentResults.map(result => `${result.examCode}:${result.componentCode}`);
      if (
        componentResults.length !== totalComponents ||
        new Set(componentIdentities).size !== componentIdentities.length
      )
        throw invalidContract();
      return {
        sheetNumber,
        productionOrderNumber: positiveIntegerOf(route['nrOrdemProducao']),
        itemCode: textOf(route['codItem'], false),
        itemDescription: textOf(route['descricaoItem'], false),
        operationSequence: positiveIntegerOf(route['sequenciaOperacao']),
        statusCode: nonNegativeIntegerOf(route['situacao']),
        released: booleanOf(route['liberada']),
        inspected: booleanOf(route['inspecionado']),
        totalComponents,
        outOfRangeComponents,
        narrative: textOf(route['narrativa'], true),
        componentResults,
      };
    });
  });
  if (new Set(routes.map(route => route.sheetNumber)).size !== routes.length) throw invalidContract();
  return routes;
}

function mapPendingComponentResult(value: unknown, expectedSheetNumber: number): PendingAuthorizedComponentResult {
  const result = objectOf(value);
  const sheetNumber = positiveIntegerOf(result['nrFicha']);
  if (sheetNumber !== expectedSheetNumber) throw invalidContract();
  const resultType = positiveIntegerOf(result['tipoResultado']);
  const withinRange = nullableBooleanOf(result['dentroFaixa']);
  if (withinRange === null && resultType !== 4) throw invalidContract();
  return {
    sheetNumber,
    examCode: positiveIntegerOf(result['codExame']),
    componentCode: positiveIntegerOf(result['codComponente']),
    componentSequence: nonNegativeIntegerOf(result['seqComp']),
    resultType,
    result: finiteNumberOf(result['resultado']),
    report: textOf(result['laudo'], true),
    tableNumber: nonNegativeIntegerOf(result['nrTabela']),
    withinRange,
  };
}

export function mapAuthorizedFinalizationEnvelope(
  value: unknown,
  expectedSheetNumber: number,
): AuthorizedRouteFinalizationOutcome {
  const envelope = envelopeOf(value);
  const matches = envelope.items
    .flatMap(item => {
      const resultValue = objectOf(item)['ds-finaliza'];
      if (resultValue === undefined) return [];
      return optionalArrayOf(objectOf(resultValue)['roteiro']).map(objectOf);
    })
    .filter(route => route['nrFicha'] === expectedSheetNumber);
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
    savedComponents + pendingComponents !== totalComponents ||
    outOfRangeComponents > totalComponents ||
    exams.some(exam => exam.savedComponents + exam.pendingComponents !== exam.totalComponents)
  )
    throw invalidContract();
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
  if (sheetNumber !== expectedSheetNumber || examCode !== expectedExamCode || componentCode !== expectedComponentCode)
    throw invalidContract();
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

function nullableBooleanOf(value: unknown): boolean | null {
  return value === null ? null : booleanOf(value);
}

function finiteNumberOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidContract();
  return value;
}

function textOf(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw invalidContract();
  return value;
}

function invalidContract(): Error {
  return new Error('invalid-upstream-response');
}
