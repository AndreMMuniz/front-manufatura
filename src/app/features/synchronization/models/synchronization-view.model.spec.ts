import { describe, expect, it } from 'vitest';

import { JsonValue } from '../../../core/offline/models/local-record';
import { OPERATIONAL_COMMAND_TYPES } from '../../../core/offline/models/operational-command';
import { OutboxEntry } from '../../../core/offline/models/outbox-entry';
import {
  buildSynchronizationIndicatorMessage,
  mapSynchronizationEntry,
} from './synchronization-view.model';

describe('synchronization view model', () => {
  it.each(OPERATIONAL_COMMAND_TYPES)('mapeia %s sem expor o envelope bruto', commandType => {
    const view = mapSynchronizationEntry(entry({
      commandType,
      payload: payloadFor(commandType),
      canonicalPayload: '{"password":"secret"}',
      payloadHash: 'private-hash',
      lastError: {
        code: 'INVALID',
        category: 'VALIDATION',
        userMessage: '<b>Falha segura</b>\u0000',
        correlationId: 'corr-1',
      },
    }));

    expect(view.moduleLabel).not.toBe('Módulo não identificado');
    expect(view.operationalIdentification.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toMatch(/private-hash|secret|canonicalPayload|password/i);
    expect(view.lastMessage).toBe('Falha segura');
    expect(view.correlationId).toBe('corr-1');
  });

  it.each([
    ['PENDING', 'Salvo neste dispositivo — envio pendente'],
    ['SYNCING', 'Sincronizando com o Datasul'],
    ['RETRY_WAIT', 'Nova tentativa agendada'],
    ['SYNCED', 'Sincronizado com o Datasul'],
    ['BLOCKED_AUTH', 'Bloqueado por autenticação/autorização'],
    ['BLOCKED_DEPENDENCY', 'Aguardando dependência/intervenção'],
    ['ERROR', 'Registro preservado — precisa de atenção'],
  ] as const)('mantém o estado %s separado do status de negócio', (status, label) => {
    const view = mapSynchronizationEntry(entry({ status, businessStatus: 'APROVADO' }));

    expect(view.syncStatusLabel).toBe(label);
    expect(view.businessStatus).toBe('APROVADO');
  });

  it.each([
    ['ABANDONED', 'Abandonado com justificativa'],
    ['SUPERSEDED', 'Substituído por comando corrigido'],
  ] as const)('prioriza a disposição %s sobre o estado anterior', (deliveryDisposition, label) => {
    const view = mapSynchronizationEntry(entry({ status: 'ERROR', deliveryDisposition }));

    expect(view.syncStatusLabel).toBe(label);
    expect(view.availableActions).toEqual([]);
  });

  it('usa fallback mínimo e sem recuperação para comando/schema/estado desconhecido', () => {
    const view = mapSynchronizationEntry(entry({
      aggregateId: '<aggregate-1>',
      commandType: 'LEGACY_UNKNOWN',
      payloadSchemaVersion: 999,
      status: 'LEGACY_UNKNOWN' as never,
      payload: { token: 'secret', description: '<img src=x>' },
    }));

    expect(view).toMatchObject({
      moduleLabel: 'Módulo não identificado',
      operationalIdentification: 'Registro aggregate-1',
      syncStatusLabel: 'Estado não identificado',
      availableActions: [],
    });
    expect(JSON.stringify(view)).not.toMatch(/secret|img src|token/i);
  });

  it('separa Ordem, Exame, Componente e Resultado do apontamento CQ', () => {
    const view = mapSynchronizationEntry(entry({
      commandType: 'SAVE_QUALITY_RESULT', aggregateType: 'QUALITY_EXAM', aggregateId: '64379',
      payload: { orderNumber: '372562', nrFicha: 64379, codExame: 1845,
        codComponente: 1, resultado: 24.01 },
    }));

    expect(view.operationalDetails).toEqual([
      { label: 'Ordem', value: '372562' },
      { label: 'Exame', value: '1845' },
      { label: 'Componente', value: '1' },
      { label: 'Resultado', value: '24,01' },
    ]);
  });

  it('explicita campos ausentes em registros CQ antigos', () => {
    const view = mapSynchronizationEntry(entry({
      commandType: 'SAVE_QUALITY_RESULT',
      payload: { codExame: 1845, codComponente: 1, resultado: 0 },
    }));

    expect(view.operationalDetails).toEqual([
      { label: 'Ordem', value: 'Não informada' },
      { label: 'Exame', value: '1845' },
      { label: 'Componente', value: '1' },
      { label: 'Resultado', value: '0' },
    ]);
  });

  it('aplica a precedência determinística das mensagens e exclui ERROR do progresso', () => {
    expect(buildSynchronizationIndicatorMessage({
      readState: 'error',
      onlineHint: true,
      counts: counts(),
    })).toBe('Não foi possível ler os registros locais');
    expect(buildSynchronizationIndicatorMessage({
      readState: 'ready',
      onlineHint: false,
      counts: counts({ error: 2, pending: 3 }),
    })).toBe('2 registros precisam de atenção');
    expect(buildSynchronizationIndicatorMessage({
      readState: 'ready',
      onlineHint: false,
      counts: counts({ pending: 3 }),
    })).toBe('Offline — 3 registros aguardando envio');
    expect(buildSynchronizationIndicatorMessage({
      readState: 'ready',
      onlineHint: true,
      counts: counts({ pending: 5, syncing: 2 }),
    })).toBe('Sincronizando — 2 de 5 ativos');
    expect(buildSynchronizationIndicatorMessage({
      readState: 'ready',
      onlineHint: true,
      counts: counts({ pending: 3 }),
    })).toBe('3 registros aguardando envio');
    expect(buildSynchronizationIndicatorMessage({
      readState: 'ready',
      onlineHint: true,
      counts: counts({ receipts: 1 }),
    })).toBe('Datasul atualizado');
    expect(buildSynchronizationIndicatorMessage({
      readState: 'ready',
      onlineHint: true,
      counts: counts(),
    })).toBe('Nenhum envio pendente');
  });
});

function counts(overrides: Partial<{
  pending: number;
  error: number;
  syncing: number;
  receipts: number;
}> = {}) {
  return {
    pending: 0,
    error: 0,
    syncing: 0,
    receipts: 0,
    ...overrides,
  };
}

function entry(
  overrides: Partial<OutboxEntry<JsonValue> & {
    deliveryDisposition: 'ACTIVE' | 'ABANDONED' | 'SUPERSEDED';
  }> = {},
): OutboxEntry<JsonValue> & {
  readonly deliveryDisposition?: 'ACTIVE' | 'ABANDONED' | 'SUPERSEDED';
} {
  return {
    localId: 'local-1',
    idempotencyKey: 'key-1',
    payloadSchemaVersion: 1,
    aggregateType: 'OPERATION',
    aggregateId: 'aggregate-1',
    commandType: 'START_OPERATION',
    payload: { ordem: '100', op: '10', split: '1' },
    canonicalPayload: '{}',
    payloadHash: 'hash',
    ownerId: 'operator-1',
    status: 'PENDING',
    dependencyIds: [],
    attemptCount: 0,
    occurredAt: '2026-07-30T12:00:00.000Z',
    createdAt: '2026-07-30T12:00:01.000Z',
    updatedAt: '2026-07-30T12:00:01.000Z',
    ...overrides,
  };
}

function payloadFor(commandType: (typeof OPERATIONAL_COMMAND_TYPES)[number]): JsonValue {
  if (commandType.includes('BATCH')) {
    return { batchId: 'batch-1', orderIds: ['100', '101'] };
  }
  if (commandType.includes('STOP')) {
    return { stopLocalId: 'stop-1', reason: { description: 'Ajuste' } };
  }
  if (commandType.includes('OPERATION')) {
    return { ordem: '100', op: '10', split: '1' };
  }
  return {
    orderNumber: '100',
    routeNumber: 'R-1',
    examId: 'E-1',
    componentId: 'C-1',
  };
}
