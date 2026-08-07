import { JsonValue } from '../../../core/offline/models/local-record';
import {
  OPERATIONAL_COMMAND_TYPES,
  OperationalCommandType,
} from '../../../core/offline/models/operational-command';
import { OutboxEntry } from '../../../core/offline/models/outbox-entry';
import { SyncStatus } from '../../../core/offline/models/sync-status';
import {
  DELIVERY_DISPOSITIONS,
  DeliveryDisposition,
} from '../../../core/offline/models/delivery-disposition';

export { DELIVERY_DISPOSITIONS };
export type { DeliveryDisposition };
export type SynchronizationRecoveryPolicy = 'CORRECTABLE' | 'RETRY_ONLY' | 'INTERVENTION';
export type SynchronizationAction =
  | 'retry'
  | 'correct'
  | 'authenticate'
  | 'resolve-dependency'
  | 'abandon';

export interface SynchronizationSourceEntry extends OutboxEntry<JsonValue> {
  readonly deliveryDisposition?: DeliveryDisposition;
  readonly supersedesLocalId?: string;
  readonly supersededByLocalId?: string;
  readonly supersededAt?: string;
  readonly supersededBy?: string;
  readonly logicalOccurredAt?: string;
  readonly abandonedAt?: string;
  readonly abandonedBy?: string;
  readonly abandonReason?: string;
}

export interface SynchronizationCounts {
  readonly pending: number;
  readonly error: number;
  readonly syncing: number;
  readonly receipts: number;
}

export interface SynchronizationFilters {
  readonly statuses: readonly (SyncStatus | DeliveryDisposition)[];
  readonly modules: readonly SynchronizationModule[];
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
  readonly identification?: string;
}

export interface SynchronizationCursor {
  readonly ownerId: string;
  readonly occurredAt: string;
  readonly localId: string;
}

export interface SynchronizationPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: SynchronizationCursor | null;
  readonly hasMore: boolean;
}

export interface SynchronizationEntryView {
  readonly localId: string;
  readonly module: SynchronizationModule;
  readonly moduleLabel: string;
  readonly commandLabel: string;
  readonly operationalIdentification: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly ownerId: string;
  readonly attemptCount: number;
  readonly lastMessage?: string;
  readonly correlationId?: string;
  readonly businessStatus: string;
  readonly syncStatus: string;
  readonly syncStatusLabel: string;
  readonly syncIcon: string;
  readonly syncTone: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  readonly disposition: DeliveryDisposition;
  readonly recoveryPolicy: SynchronizationRecoveryPolicy;
  readonly recoveryRoute?: string;
  readonly availableActions: readonly SynchronizationAction[];
  readonly nextAttemptAt?: string;
  readonly supersedesLocalId?: string;
  readonly supersededByLocalId?: string;
}

export type SynchronizationModule =
  | 'QUALITY'
  | 'OPERATION'
  | 'BATCH'
  | 'STOPPAGE'
  | 'UNKNOWN';

interface CommandPresentation {
  readonly module: Exclude<SynchronizationModule, 'UNKNOWN'>;
  readonly moduleLabel: string;
  readonly commandLabel: string;
  readonly route: string;
  readonly policy: SynchronizationRecoveryPolicy;
  readonly identify: (payload: Readonly<Record<string, unknown>>, aggregateId: string) => string;
}

const COMMAND_PRESENTATIONS: Readonly<Record<OperationalCommandType, CommandPresentation>> =
  Object.freeze({
    GENERATE_INSPECTION_ROUTE: quality('Gerar roteiro', 'CORRECTABLE'),
    SAVE_MEASUREMENT: quality('Salvar medição', 'CORRECTABLE'),
    FINISH_EXAM: quality('Finalizar exame', 'RETRY_ONLY'),
    STOP_INSPECTION_ROUTE: quality('Parar roteiro', 'INTERVENTION'),
    SAVE_INSPECTION: quality('Salvar inspeção', 'CORRECTABLE'),
    START_OPERATION: operation('Iniciar operação', 'CORRECTABLE'),
    REPORT_OPERATION: operation('Reportar operação', 'CORRECTABLE'),
    END_OPERATION: operation('Encerrar operação', 'RETRY_ONLY'),
    START_BATCH: batch('Iniciar batelada', 'CORRECTABLE'),
    REPORT_BATCH: batch('Reportar batelada', 'CORRECTABLE'),
    END_BATCH: batch('Encerrar batelada', 'RETRY_ONLY'),
    CREATE_STOP: stoppage('Registrar parada', 'CORRECTABLE'),
    FINISH_STOP: stoppage('Finalizar parada', 'CORRECTABLE'),
  });

const STATUS_PRESENTATIONS: Readonly<Record<SyncStatus, {
  readonly label: string;
  readonly icon: string;
  readonly tone: SynchronizationEntryView['syncTone'];
}>> = Object.freeze({
  PENDING: status('Salvo neste dispositivo — envio pendente', 'po-icon-clock', 'warning'),
  SYNCING: status('Sincronizando com o Datasul', 'po-icon-refresh', 'info'),
  RETRY_WAIT: status('Nova tentativa agendada', 'po-icon-clock', 'warning'),
  SYNCED: status('Sincronizado com o Datasul', 'po-icon-ok', 'success'),
  BLOCKED_AUTH: status(
    'Bloqueado por autenticação/autorização',
    'po-icon-lock',
    'warning',
  ),
  BLOCKED_DEPENDENCY: status(
    'Aguardando dependência/intervenção',
    'po-icon-link',
    'warning',
  ),
  ERROR: status('Registro preservado — precisa de atenção', 'po-icon-warning', 'danger'),
});

export function mapSynchronizationEntry(
  source: SynchronizationSourceEntry,
): SynchronizationEntryView {
  const command = isOperationalCommandType(source.commandType) && source.payloadSchemaVersion === 1
    ? COMMAND_PRESENTATIONS[source.commandType]
    : undefined;
  const disposition = isDeliveryDisposition(source.deliveryDisposition)
    ? source.deliveryDisposition
    : 'ACTIVE';
  const state = isSyncStatus(source.status) ? STATUS_PRESENTATIONS[source.status] : undefined;
  const dispositionState = disposition === 'ABANDONED'
    ? status('Abandonado com justificativa', 'po-icon-close', 'neutral')
    : disposition === 'SUPERSEDED'
      ? status('Substituído por comando corrigido', 'po-icon-exchange', 'neutral')
      : undefined;
  const payload = record(source.payload);
  const presentation = dispositionState ?? state ?? status(
    'Estado não identificado',
    'po-icon-help',
    'neutral',
  );

  return Object.freeze({
    localId: source.localId,
    module: command?.module ?? 'UNKNOWN',
    moduleLabel: command?.moduleLabel ?? 'Módulo não identificado',
    commandLabel: command?.commandLabel ?? 'Comando legado',
    operationalIdentification: command
      ? command.identify(payload, source.aggregateId)
      : `Registro ${safeIdentifier(source.aggregateId, 'não identificado')}`,
    occurredAt: source.occurredAt,
    createdAt: source.createdAt,
    ownerId: source.ownerId,
    attemptCount: source.attemptCount,
    ...(source.lastError?.userMessage
      ? { lastMessage: safeText(source.lastError.userMessage, 'Falha não detalhada') }
      : {}),
    ...(source.lastError?.correlationId
      ? { correlationId: safeText(source.lastError.correlationId, '') }
      : {}),
    businessStatus: safeText(source.businessStatus, 'Não informado'),
    syncStatus: String(source.status),
    syncStatusLabel: presentation.label,
    syncIcon: presentation.icon,
    syncTone: presentation.tone,
    disposition,
    recoveryPolicy: command?.policy ?? 'INTERVENTION',
    ...(command ? { recoveryRoute: command.route } : {}),
    availableActions: Object.freeze(actions(source, disposition, command)),
    ...(source.nextAttemptAt ? { nextAttemptAt: source.nextAttemptAt } : {}),
    ...(source.supersedesLocalId
      ? { supersedesLocalId: safeText(source.supersedesLocalId, '') }
      : {}),
    ...(source.supersededByLocalId
      ? { supersededByLocalId: safeText(source.supersededByLocalId, '') }
      : {}),
  });
}

export function buildSynchronizationIndicatorMessage(input: {
  readonly readState: 'loading' | 'ready' | 'error' | 'unavailable';
  readonly onlineHint: boolean;
  readonly counts: SynchronizationCounts;
}): string {
  if (input.readState === 'error') return 'Não foi possível ler os registros locais';
  if (input.readState === 'unavailable') return 'Armazenamento local indisponível';
  if (input.readState === 'loading') return 'Consultando registros locais';
  if (input.counts.error > 0) {
    return `${input.counts.error} ${plural(input.counts.error, 'registro precisa', 'registros precisam')} de atenção`;
  }
  if (!input.onlineHint && input.counts.pending > 0) {
    return `Offline — ${input.counts.pending} ${plural(input.counts.pending, 'registro aguardando', 'registros aguardando')} envio`;
  }
  if (input.counts.syncing > 0) {
    return `Sincronizando — ${input.counts.syncing} de ${input.counts.pending} ativos`;
  }
  if (input.counts.pending > 0) {
    return `${input.counts.pending} ${plural(input.counts.pending, 'registro aguardando', 'registros aguardando')} envio`;
  }
  return input.counts.receipts > 0 ? 'Datasul atualizado' : 'Nenhum envio pendente';
}

function actions(
  source: SynchronizationSourceEntry,
  disposition: DeliveryDisposition,
  command: CommandPresentation | undefined,
): SynchronizationAction[] {
  if (disposition !== 'ACTIVE' || !command) return [];
  if (source.status === 'ERROR') {
    return [
      'retry',
      ...(command.policy === 'CORRECTABLE' ? ['correct' as const] : []),
      'abandon',
    ];
  }
  if (source.status === 'BLOCKED_AUTH') return ['authenticate'];
  if (source.status === 'BLOCKED_DEPENDENCY') return ['resolve-dependency'];
  if (source.status !== 'SYNCED' && source.status !== 'SYNCING') return ['abandon'];
  return [];
}

function quality(
  commandLabel: string,
  policy: SynchronizationRecoveryPolicy,
): CommandPresentation {
  return {
    module: 'QUALITY',
    moduleLabel: 'Plano Controle CQ',
    commandLabel,
    route: '/quality-control',
    policy,
    identify: (payload, aggregateId) => {
      const order = text(payload, 'orderNumber', 'opNumber', 'ordem');
      const route = text(payload, 'routeNumber');
      const exam = text(payload, 'examId', 'examCode');
      const component = text(payload, 'componentId', 'componentCode');
      return joinIdentification([
        order && `Ordem ${order}`,
        route && `Roteiro ${route}`,
        exam && `Exame ${exam}`,
        component && `Componente ${component}`,
      ], aggregateId);
    },
  };
}

function operation(
  commandLabel: string,
  policy: SynchronizationRecoveryPolicy,
): CommandPresentation {
  return {
    module: 'OPERATION',
    moduleLabel: 'Reporte de Operação',
    commandLabel,
    route: '/operation-reporting',
    policy,
    identify: (payload, aggregateId) => joinIdentification([
      text(payload, 'ordem', 'orderNumber') && `OP ${text(payload, 'ordem', 'orderNumber')}`,
      text(payload, 'op', 'operationCode') && `Operação ${text(payload, 'op', 'operationCode')}`,
      text(payload, 'split') && `Split ${text(payload, 'split')}`,
    ], aggregateId),
  };
}

function batch(commandLabel: string, policy: SynchronizationRecoveryPolicy): CommandPresentation {
  return {
    module: 'BATCH',
    moduleLabel: 'Reporte de Batelada',
    commandLabel,
    route: '/batch-reporting',
    policy,
    identify: (payload, aggregateId) => {
      const batchId = text(payload, 'batchId') || safeText(aggregateId, 'não identificada');
      const orders = array(payload['orderIds']) ?? array(payload['ordens']) ?? array(payload['items']);
      return `Batelada ${batchId}${orders ? ` · ${orders.length} ${plural(orders.length, 'ordem', 'ordens')}` : ''}`;
    },
  };
}

function stoppage(
  commandLabel: string,
  policy: SynchronizationRecoveryPolicy,
): CommandPresentation {
  return {
    module: 'STOPPAGE',
    moduleLabel: 'Reporte de Paradas',
    commandLabel,
    route: '/stoppages',
    policy,
    identify: (payload, aggregateId) => {
      const stopId = text(payload, 'stopLocalId', 'localId', 'id') || safeText(
        aggregateId,
        'não identificada',
      );
      const reason = text(record(payload['reason']), 'description', 'descricao', 'nome');
      return `Parada ${stopId}${reason ? ` · ${reason}` : ''}`;
    },
  };
}

function status(
  label: string,
  icon: string,
  tone: SynchronizationEntryView['syncTone'],
) {
  return Object.freeze({ label, icon, tone });
}

function isOperationalCommandType(value: string): value is OperationalCommandType {
  return (OPERATIONAL_COMMAND_TYPES as readonly string[]).includes(value);
}

function isSyncStatus(value: string): value is SyncStatus {
  return Object.hasOwn(STATUS_PRESENTATIONS, value);
}

function isDeliveryDisposition(value: unknown): value is DeliveryDisposition {
  return (DELIVERY_DISPOSITIONS as readonly unknown[]).includes(value);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function array(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function text(value: Readonly<Record<string, unknown>>, ...keys: readonly string[]): string {
  for (const key of keys) {
    if (typeof value[key] === 'string') {
      const sanitized = safeText(value[key] as string, '');
      if (sanitized) return sanitized;
    }
  }
  return '';
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const sanitized = value
    .normalize('NFC')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return sanitized || fallback;
}

function safeIdentifier(value: unknown, fallback: string): string {
  return safeText(
    typeof value === 'string' ? value.replace(/[<>]/g, '') : value,
    fallback,
  );
}

function joinIdentification(values: readonly (string | undefined)[], aggregateId: string): string {
  const result = values.filter(Boolean).join(' · ');
  return result || `Registro ${safeText(aggregateId, 'não identificado')}`;
}

function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}
