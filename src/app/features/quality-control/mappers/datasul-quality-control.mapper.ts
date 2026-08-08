import { DatasulEnvelope } from '../interfaces/datasul-quality-control.dto';
import {
  ProductionOrderOperation,
  ProductionOrderOperationsResult,
  ProductionOrderRoute,
} from '../models/production-order-route';
import { QualityExam, QualityExamComponent } from '../models/quality-exam';

export function mapProductionOrderEnvelope(value: unknown): ProductionOrderOperationsResult {
  const envelope = envelopeOf(value);
  const orders = envelope.items.flatMap(item => {
    const record = objectOf(item);
    const dataset = objectOf(record['ds-ordem-producao']);
    return arrayOf(dataset['ordem']).map(objectOf);
  });
  const order = orders[0];
  if (!order) throw invalidContract();
  const orderNumber = integerOf(order['nrOrdemProducao']).toString();
  const orderItem = textOf(order['codItem']);
  const operations = arrayOf(order['operacoes']).flatMap(operationValue => {
    const operation = objectOf(operationValue);
    const splits = arrayOf(operation['splits']);
    const base = {
      operationCode: integerOf(operation['codOperacao']).toString(),
      operationDescription: textOf(operation['descricaoOperacao']),
      itemCode: optionalText(operation['codItem']) || orderItem,
      itemDescription: '',
      processDescription: textOf(operation['descricaoOperacao']),
    };
    return splits.length
      ? splits.map(splitValue => {
          const split = objectOf(splitValue);
          return { ...base, split: integerOf(split['numSplit']).toString() };
        })
      : [base];
  }) satisfies ProductionOrderOperation[];
  return { orderNumber, operations };
}

export function mapInspectionRouteEnvelope(
  value: unknown,
  context: {
    readonly orderNumber: string;
    readonly operation: ProductionOrderOperation;
  },
): { readonly route: ProductionOrderRoute; readonly exams: QualityExam[] } {
  const envelope = envelopeOf(value);
  const first = objectOf(envelope.items[0]);
  const nrFicha = integerOf(first['nrFicha']);
  const dataset = objectOf(first['ds-roteiro']);
  const exams = uniqueById(arrayOf(dataset['exames']).map((exam, index) =>
    mapExam(exam, nrFicha, index)));
  const operation = context.operation;
  return {
    route: {
      nrFicha,
      routeNumber: String(nrFicha),
      processDescription: operation.processDescription,
      currentOrder: context.orderNumber,
      operationCode: operation.operationCode,
      operationDescription: `${operation.operationCode} - ${operation.operationDescription}`,
      split: operation.split?.trim() || '1',
      itemCode: operation.itemCode,
      itemDescription: operation.itemDescription,
      exams,
    },
    exams,
  };
}

function mapExam(value: unknown, nrFicha: number, examIndex: number): QualityExam {
  const exam = objectOf(value);
  const code = integerOf(exam['codExame']);
  return {
    id: `${nrFicha}-${code}`,
    code: String(code),
    description: textOf(exam['descricao']),
    version: String(integerOf(exam['versao'])),
    frequency: String(integerOf(exam['frequencia'])),
    sample: String(integerOf(exam['amostra'])),
    unit: '',
    nqa: String(numberOf(exam['nqa'])),
    level: String(integerOf(exam['nivel'])),
    responsible: optionalText(exam['responsavel']),
    observation: optionalText(exam['observacao']),
    components: uniqueById(arrayOf(exam['componentes']).map((item, index) =>
      mapComponent(item, nrFicha, code, examIndex * 10000 + index))),
  };
}

function mapComponent(
  value: unknown,
  nrFicha: number,
  examCode: number,
  sequence: number,
): QualityExamComponent {
  const component = objectOf(value);
  const code = integerOf(component['codComponente']);
  if (integerOf(component['codExame']) !== examCode) throw invalidContract();
  const minValue = numberOf(component['resultadoMin']);
  const maxValue = numberOf(component['resultadoMax']);
  const options = component['opcoesResultado'] === undefined
    ? []
    : arrayOf(component['opcoesResultado']).map(optionValue => {
        const option = objectOf(optionValue);
        const tableNumber = integerOf(option['nrTabela']);
        if (
          integerOf(option['codExame']) !== examCode
          || integerOf(option['codComponente']) !== code
          || tableNumber !== integerOf(component['nrTabela'])
        ) throw invalidContract();
        return {
          tableNumber,
          sequence: integerOf(option['seqOpcao']),
          description: textOf(option['descricao']),
        };
      });
  return {
    id: `${nrFicha}-${examCode}-${code}`,
    code: String(code),
    examCode,
    componentCode: code,
    tableNumber: integerOf(component['nrTabela']),
    resultType: integerOf(component['tipoResultado']),
    decimalPlaces: nonNegativeIntegerOf(component['numeroDecimais']),
    description: textOf(component['descricao']),
    reference: optionalText(component['referenciaTecnica']) || `${minValue} - ${maxValue}`,
    measurementMethod: optionalText(component['equipamento']) || optionalText(component['metodo']),
    minValue,
    maxValue,
    unit: optionalText(component['unidade']),
    sequence,
    resultOptions: options,
    status: 'PENDING',
  };
}

function envelopeOf(value: unknown): DatasulEnvelope<unknown> {
  const record = objectOf(value);
  const total = integerOf(record['total']);
  if (typeof record['hasNext'] !== 'boolean') throw invalidContract();
  const items = arrayOf(record['items']);
  if (total < 1 || items.length < 1 || record['hasNext'] || total !== items.length) {
    throw invalidContract();
  }
  return { total, hasNext: record['hasNext'], items };
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidContract();
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidContract();
  return value;
}

function integerOf(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw invalidContract();
  return value as number;
}

function nonNegativeIntegerOf(value: unknown): number {
  const integer = integerOf(value);
  if (integer < 0) throw invalidContract();
  return integer;
}

function uniqueById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length) throw invalidContract();
  return [...items];
}

function numberOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidContract();
  return value;
}

function textOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidContract();
  return value;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function invalidContract(): Error {
  return new Error('invalid-upstream-response');
}
