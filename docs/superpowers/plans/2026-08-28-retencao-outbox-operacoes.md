# Retenção e Compactação da Outbox de Operações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir crescimento ilimitado do IndexedDB compactando somente agregados de operação encerrados e totalmente sincronizados, enquanto preserva um recibo mínimo por 30 dias e no máximo 500 recibos por usuário.

**Architecture:** Uma migration v4 adiciona um store separado `syncReceipts`, evitando mutilar `LocalRecord` e quebrar sua integridade de payload/hash. Um repositório faz a compactação atômica entre `localRecords`, `outbox` e o novo arquivo apenas quando o `END_OPERATION` está `SYNCED`, todos os comandos do agregado estão `SYNCED` e nenhum comando ativo depende deles. Um serviço de retenção executa a política no startup e depois de ciclos de sincronização, sem transformar falha de limpeza em falha de envio.

**Tech Stack:** Angular 21, TypeScript 5.9, IndexedDB v4, fake-indexeddb 6.2, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-28-reporte-operacao-envio-imediato-design.md`

## Global Constraints

- Nunca apagar `PENDING`, `SYNCING`, `RETRY_WAIT`, `BLOCKED_AUTH`, `BLOCKED_DEPENDENCY` ou `ERROR`.
- Nunca apagar um comando que possua dependentes ativos.
- Não compactar reportes enquanto a operação estiver ativa.
- Somente considerar o agregado após `END_OPERATION` reconciliado como `SYNCED`.
- Reter recibos mínimos por 30 dias e no máximo 500 registros por owner.
- A migration v4 deve ser aditiva e preservar integralmente bancos v1, v2 e v3.
- Erro de cleanup deve ser observável, mas não pode alterar um comando já reconciliado nem derrubar o ciclo de sync.
- Não modificar migrations históricas v1–v3.
- Processar no máximo 25 agregados encerrados por execução de cleanup; ciclos posteriores continuam
  o trabalho. Esse teto limita scans/transações pós-sync sem alterar os 30 dias/500 recibos.

---

## File Structure

- `src/app/core/offline/models/sync-receipt-record.ts`: modelo mínimo arquivado.
- `src/app/core/offline/database/database-schema.ts`: versão 4, store e índices atuais.
- `src/app/core/offline/database/database-migrations.ts`: migration aditiva v4 imutável.
- `src/app/core/offline/repositories/sync-retention.repository.ts`: elegibilidade e transação atômica de arquivo/exclusão.
- `src/app/core/offline/services/sync-retention.service.ts`: política de 30 dias/500 e execução segura por owner.
- `src/app/core/offline/services/sync-coordinator.service.ts`: hook não bloqueante após cada ciclo.
- `src/app/app.config.ts`: cleanup no startup do browser.
- Specs adjacentes validam migration, invariantes, triggers e restauração ativa.

### Task 1: Adicionar o arquivo de recibos e a migration v4

**Files:**
- Create: `src/app/core/offline/models/sync-receipt-record.ts`
- Modify: `src/app/core/offline/database/database-schema.ts`
- Modify: `src/app/core/offline/database/database-migrations.ts`
- Test: `src/app/core/offline/database/database-migrations.spec.ts`

**Interfaces:**
- Consumes: `RemoteCommandReceipt` e metadados estáveis de `OutboxEntry`.
- Produces: `SYNC_RECEIPTS_STORE`, `SyncReceiptRecord` e schema IndexedDB v4.

- [ ] **Step 1: Escrever testes falhando para instalação nova e upgrade v3→v4**

```ts
it('cria syncReceipts na versão 4 com índices de owner, expiração e agregado', async () => {
  const database = await openDatabase(new IDBFactory(), DATABASE_VERSION, DATABASE_MIGRATIONS);
  const store = database.transaction(SYNC_RECEIPTS_STORE).objectStore(SYNC_RECEIPTS_STORE);

  expect(DATABASE_VERSION).toBe(4);
  expect([...database.objectStoreNames]).toEqual(['localRecords', 'outbox', 'syncReceipts']);
  expect([...store.indexNames]).toEqual([
    'ownerAggregate', 'ownerArchivedAt', 'ownerExpiresAt', 'ownerId',
  ]);
});

it('preserva stores v3 e adiciona syncReceipts no upgrade', async () => {
  const factory = new IDBFactory();
  const v3 = await openDatabase(factory, 3, DATABASE_MIGRATIONS.slice(0, 3));
  await addAndComplete(v3, OUTBOX_STORE, pendingFixture('ERROR'));
  v3.close();

  const v4 = await openDatabase(factory, 4, DATABASE_MIGRATIONS);
  expect(await requestResult(v4.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll()))
    .toHaveLength(1);
  expect(v4.objectStoreNames.contains(SYNC_RECEIPTS_STORE)).toBe(true);
});
```

- [ ] **Step 2: Executar o spec e confirmar a falha**

Run: `npm test -- --watch=false --include='src/app/core/offline/database/database-migrations.spec.ts'`

Expected: FAIL porque a versão é 3 e o store não existe.

- [ ] **Step 3: Criar o modelo mínimo**

```ts
export interface SyncReceiptRecord {
  readonly localId: string;
  readonly ownerId: string;
  readonly idempotencyKey: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly status: 'SYNCED';
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly synchronizedAt: string;
  readonly archivedAt: string;
  readonly expiresAt: string;
  readonly receipt: RemoteCommandReceipt;
}
```

- [ ] **Step 4: Acrescentar o schema e a migration sem editar snapshots antigos**

Em `database-schema.ts`:

```ts
export const DATABASE_VERSION = 4;
export const SYNC_RECEIPTS_STORE = 'syncReceipts';
export type OfflineStoreName =
  | typeof LOCAL_RECORDS_STORE
  | typeof OUTBOX_STORE
  | typeof SYNC_RECEIPTS_STORE;
```

Adicionar ao schema atual os índices `ownerId`, `ownerArchivedAt`, `ownerExpiresAt` e `ownerAggregate`. Em `database-migrations.ts`:

```ts
const SYNC_RECEIPTS_MIGRATION: DatabaseMigration = {
  toVersion: 4,
  migrate: ({ database }) => {
    const store = database.createObjectStore(SYNC_RECEIPTS_STORE, { keyPath: 'localId' });
    store.createIndex('ownerId', 'ownerId', { unique: false });
    store.createIndex('ownerArchivedAt', ['ownerId', 'archivedAt'], { unique: false });
    store.createIndex('ownerExpiresAt', ['ownerId', 'expiresAt'], { unique: false });
    store.createIndex(
      'ownerAggregate',
      ['ownerId', 'aggregateType', 'aggregateId'],
      { unique: false },
    );
  },
};
```

Acrescentar `SYNC_RECEIPTS_MIGRATION` ao final de `DATABASE_MIGRATIONS`.

- [ ] **Step 5: Executar os testes de migration e database**

Run: `npm test -- --watch=false --include='src/app/core/offline/database/database-migrations.spec.ts' --include='src/app/core/offline/database/offline-database.spec.ts'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/offline/models/sync-receipt-record.ts src/app/core/offline/database
git commit -m "feat: add sync receipt archive store"
```

### Task 2: Compactar um agregado encerrado em uma transação

**Files:**
- Create: `src/app/core/offline/repositories/sync-retention.repository.ts`
- Create: `src/app/core/offline/repositories/sync-retention.repository.spec.ts`

**Interfaces:**
- Consumes: os três stores, `OutboxEntry`, `LocalRecord` e `SyncReceiptRecord`.
- Produces: `compactClosedAggregate(ownerId, aggregateType, aggregateId, archivedAt, expiresAt): Promise<'compacted' | 'ineligible'>` e `pruneReceipts(ownerId, now, maxRecords): Promise<number>`.

- [ ] **Step 1: Escrever testes falhando para as invariantes de segurança**

Criar fixtures START/REPORT/END e cobrir:

```ts
it.each(['PENDING', 'SYNCING', 'RETRY_WAIT', 'BLOCKED_AUTH', 'BLOCKED_DEPENDENCY', 'ERROR'])
  ('não compacta quando existe comando %s', async status => {
    await seedClosedAggregate({ reportStatus: status });
    await expect(repository.compactClosedAggregate(
      'operator-1', 'OPERATION', '450001|10|1', archivedAt, expiresAt,
    )).resolves.toBe('ineligible');
    expect(await readOutbox()).toHaveLength(3);
    expect(await readReceipts()).toHaveLength(0);
  });

it('não compacta sem END_OPERATION sincronizado', async () => {
  await seedActiveAggregate();
  await expect(compact()).resolves.toBe('ineligible');
});

it('não compacta quando outro comando ativo depende do agregado', async () => {
  await seedClosedAggregate();
  await seedDependentCommand({ dependencyIds: [reportLocalId], status: 'PENDING' });
  await expect(compact()).resolves.toBe('ineligible');
});

it('arquiva recibos e remove localRecords/outbox atomicamente quando elegível', async () => {
  await seedClosedAggregate();
  await expect(compact()).resolves.toBe('compacted');
  expect(await readOutbox()).toEqual([]);
  expect(await readLocalRecords()).toEqual([]);
  expect(await readReceipts()).toEqual(expect.arrayContaining([
    expect.objectContaining({ localId: reportLocalId, status: 'SYNCED', expiresAt }),
  ]));
});
```

- [ ] **Step 2: Executar o spec e confirmar que o repositório não existe**

Run: `npm test -- --watch=false --include='src/app/core/offline/repositories/sync-retention.repository.spec.ts'`

Expected: FAIL com import não resolvido.

- [ ] **Step 3: Implementar elegibilidade dentro da transação readwrite**

Abrir uma única transação com os três stores. Ler o agregado pelos índices `ownerAggregate`/`ownerAggregateOrder`, depois todos os itens do owner para detectar dependentes ativos. Considerar elegível somente se:

```ts
const allSynced = aggregateOutbox.length > 0
  && aggregateOutbox.every(entry => entry.status === 'SYNCED' && entry.receipt);
const ended = aggregateOutbox.some(entry => entry.commandType === 'END_OPERATION');
const localIds = new Set(aggregateOutbox.map(entry => entry.localId));
const hasActiveDependent = ownerOutbox.some(entry =>
  entry.status !== 'SYNCED'
  && entry.dependencyIds.some(dependencyId => localIds.has(dependencyId)),
);
if (!allSynced || !ended || hasActiveDependent) return 'ineligible';
```

Para cada entry criar:

```ts
const archived: SyncReceiptRecord = {
  localId: entry.localId,
  ownerId: entry.ownerId,
  idempotencyKey: entry.idempotencyKey,
  aggregateType: entry.aggregateType,
  aggregateId: entry.aggregateId,
  commandType: entry.commandType,
  status: 'SYNCED',
  occurredAt: entry.occurredAt,
  createdAt: entry.createdAt,
  synchronizedAt: entry.synchronizedAt!,
  archivedAt,
  expiresAt,
  receipt: entry.receipt!,
};
receiptStore.put(archived);
outboxStore.delete(entry.localId);
localStore.delete(entry.localId);
```

Aguardar `transactionComplete(transaction)`; publicar `OutboxActivityService.publish()` somente após commit.

- [ ] **Step 4: Implementar poda por expiração e limite**

`pruneReceipts()` deve listar somente o owner, ordenar por `archivedAt` descendente e apagar a união de:

```ts
const expired = records.filter(record => Date.parse(record.expiresAt) <= Date.parse(now));
const overflow = records.slice(Math.max(0, maxRecords));
const deleteIds = new Set([...expired, ...overflow].map(record => record.localId));
```

Validar `maxRecords` como inteiro positivo e owner não vazio.

- [ ] **Step 5: Executar os testes do repositório**

Run: `npm test -- --watch=false --include='src/app/core/offline/repositories/sync-retention.repository.spec.ts'`

Expected: PASS, incluindo rollback integral se um `put` no receipt store falhar.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/offline/repositories/sync-retention.repository.ts src/app/core/offline/repositories/sync-retention.repository.spec.ts
git commit -m "feat: compact synchronized operation aggregates"
```

### Task 3: Aplicar a política de 30 dias e 500 recibos

**Files:**
- Create: `src/app/core/offline/services/sync-retention.service.ts`
- Create: `src/app/core/offline/services/sync-retention.service.spec.ts`

**Interfaces:**
- Consumes: `OutboxRepository.listByOwner(ownerId)` e os métodos da Task 2.
- Produces: `SyncRetentionService.cleanupOwner(ownerId: string): Promise<SyncRetentionSummary>`.

- [ ] **Step 1: Escrever testes falhando para seleção de agregados e política**

```ts
it('tenta compactar uma vez cada agregado de operação com END_OPERATION SYNCED', async () => {
  outbox.listByOwner.mockResolvedValue([
    endEntry('op-1'), reportEntry('op-1'), endEntry('op-2'), endEntry('op-1'),
  ]);

  await service.cleanupOwner('operator-1');

  expect(repository.compactClosedAggregate.mock.calls).toEqual([
    ['operator-1', 'OPERATION', 'op-1', nowIso, expiresAt],
    ['operator-1', 'OPERATION', 'op-2', nowIso, expiresAt],
  ]);
  expect(repository.pruneReceipts).toHaveBeenCalledWith('operator-1', nowIso, 500);
});

it('não seleciona agregado ativo nem END_OPERATION não sincronizado', async () => {
  outbox.listByOwner.mockResolvedValue([reportEntry('op-1'), endEntry('op-2', 'ERROR')]);
  await service.cleanupOwner('operator-1');
  expect(repository.compactClosedAggregate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Executar o spec e confirmar que o serviço não existe**

Run: `npm test -- --watch=false --include='src/app/core/offline/services/sync-retention.service.spec.ts'`

Expected: FAIL com import não resolvido.

- [ ] **Step 3: Criar configuração e resumo explícitos**

```ts
export const SYNC_RETENTION_DAYS = 30;
export const SYNC_RETENTION_MAX_PER_OWNER = 500;
export const SYNC_RETENTION_MAX_AGGREGATES_PER_RUN = 25;

export interface SyncRetentionSummary {
  readonly compactedAggregates: number;
  readonly prunedReceipts: number;
}
```

Calcular `expiresAt` a partir do clock injetável:

```ts
const now = this.clock();
const archivedAt = now.toISOString();
const expiresAt = new Date(
  now.getTime() + SYNC_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
).toISOString();
```

Deduplicar a chave `${aggregateType}\u0000${aggregateId}` e filtrar `commandType === 'END_OPERATION' && status === 'SYNCED'` antes de chamar o repositório.

- [ ] **Step 4: Executar o spec do serviço**

Run: `npm test -- --watch=false --include='src/app/core/offline/services/sync-retention.service.spec.ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/offline/services/sync-retention.service.ts src/app/core/offline/services/sync-retention.service.spec.ts
git commit -m "feat: enforce outbox receipt retention policy"
```

### Task 4: Disparar cleanup no startup e após ciclos de sync

**Files:**
- Modify: `src/app/core/offline/services/sync-coordinator.service.ts`
- Modify: `src/app/core/offline/services/sync-coordinator.service.spec.ts`
- Modify: `src/app/app.config.ts`
- Modify: `src/app/app.config.spec.ts`

**Interfaces:**
- Consumes: `SyncRetentionService.cleanupOwner(ownerId)` da Task 3.
- Produces: execução best-effort no browser startup e ao final de cada `processOwner`.

- [ ] **Step 1: Escrever testes falhando para os dois gatilhos e isolamento de erro**

No spec do coordenador:

```ts
it('executa retenção depois de drenar o owner', async () => {
  await coordinator.requestSync();
  expect(retention.cleanupOwner).toHaveBeenCalledWith('operator-1');
});

it('não rejeita o ciclo quando o cleanup falha', async () => {
  retention.cleanupOwner.mockRejectedValue(new Error('storage'));
  await expect(coordinator.requestSync()).resolves.toBeUndefined();
  expect(outboxEntry().status).toBe('SYNCED');
});
```

No spec de app config, estender a ordem esperada:

```ts
expect(order).toEqual(['pwa', 'storage', 'retention', 'sync']);
expect(retention.cleanupCurrentOwner).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Executar os dois specs e confirmar a ausência dos gatilhos**

Run: `npm test -- --watch=false --include='src/app/core/offline/services/sync-coordinator.service.spec.ts' --include='src/app/app.config.spec.ts'`

Expected: FAIL porque retenção ainda não é injetada nem chamada.

- [ ] **Step 3: Adicionar um wrapper seguro ao serviço**

Acrescentar ao `SyncRetentionService`:

```ts
async cleanupCurrentOwner(): Promise<SyncRetentionSummary | null> {
  const ownerId = this.auth.currentUser?.id.trim();
  return ownerId ? this.cleanupOwner(ownerId) : null;
}
```

No coordenador, injetar o serviço e, no fim de `processOwner`, executar sem propagar falha:

```ts
try {
  await this.retention.cleanupOwner(owner);
} catch {
  this.captureFailure('sync_storage_failed', 'retention', 'STORAGE_FAILURE');
}
```

Estruturar `processOwner` com `try/finally` para que o cleanup aconteça também quando não há candidatos; não o executar se `owner/epoch` ficou obsoleto.

- [ ] **Step 4: Integrar ao startup do browser**

Estender `initializeSyncRuntime` com argumento opcional:

```ts
retention?: Pick<SyncRetentionService, 'cleanupCurrentOwner'>,
```

e dentro do callback, antes de `coordinator.start()`:

```ts
void retention?.cleanupCurrentOwner().catch(() => undefined);
coordinator.start();
```

Injetar `SyncRetentionService` no `provideAppInitializer`. SSR continua sem executar qualquer callback.

- [ ] **Step 5: Executar specs do serviço, coordenador e bootstrap**

Run: `npm test -- --watch=false --include='src/app/core/offline/services/sync-retention.service.spec.ts' --include='src/app/core/offline/services/sync-coordinator.service.spec.ts' --include='src/app/app.config.spec.ts'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/offline/services/sync-retention.service.ts src/app/core/offline/services/sync-coordinator.service.ts src/app/core/offline/services/sync-coordinator.service.spec.ts src/app/app.config.ts src/app/app.config.spec.ts
git commit -m "feat: run outbox retention after synchronization"
```

### Task 5: Regressão de restauração, verificação e grafo

**Files:**
- Modify generated graph files under: `graphify-out/`
- Test: `src/app/features/report-operacao/services/report-operacao.service.spec.ts`

**Interfaces:**
- Consumes: política completa das Tasks 1–4.
- Produces: garantia de que operações ativas continuam restauráveis e que o schema/grafo representam a retenção.

- [ ] **Step 1: Acrescentar regressão de operação ativa**

No spec de `ReportOperacaoService`, semear START + REPORT sem END e executar cleanup antes de restaurar:

```ts
it('mantém START e REPORT restauráveis enquanto não existe END_OPERATION sincronizado', async () => {
  await seedActiveOperationWithReport();
  await retention.cleanupOwner('1');

  const restored = await firstValueFrom(service.restaurarOperacaoAtiva());

  expect(restored?.operation.ordem).toBe('450001');
  expect(restored?.reportes).toHaveLength(1);
});
```

- [ ] **Step 2: Executar a regressão e a suíte offline focada**

Run:

```bash
npm test -- --watch=false \
  --include='src/app/core/offline/database/database-migrations.spec.ts' \
  --include='src/app/core/offline/database/offline-database.spec.ts' \
  --include='src/app/core/offline/repositories/sync-retention.repository.spec.ts' \
  --include='src/app/core/offline/services/sync-retention.service.spec.ts' \
  --include='src/app/core/offline/services/sync-coordinator.service.spec.ts' \
  --include='src/app/features/report-operacao/services/report-operacao.service.spec.ts' \
  --include='src/app/app.config.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Executar build e inspeção estática**

Run: `npm run build`

Expected: exit code 0.

Run: `git diff --check`

Expected: nenhuma saída.

- [ ] **Step 4: Atualizar e validar o knowledge graph**

Run: `graphify update .`

Expected: atualização AST concluída.

Run:

```bash
graphify explain "SyncRetentionService"
graphify explain ".compactClosedAggregate()"
graphify explain "SyncCoordinatorService"
```

Expected: os símbolos AST apontam, respectivamente, para a política limitada de retenção, a
revalidação transacional do agregado e o gatilho pós-ciclo não bloqueante. Uma query em linguagem
natural pode ser usada como navegação complementar, mas não deve exigir o literal `END_OPERATION`:
literais de string não são nós AST garantidos. A seleção de `END_OPERATION` sincronizado permanece
verificada pelos specs do serviço e do repositório.

Run opcional: `graphify query "Quando recibos sincronizados podem ser compactados?"`

- [ ] **Step 5: Commit final**

```bash
git add src/app/features/report-operacao/services/report-operacao.service.spec.ts graphify-out
git commit -m "test: protect active operation restoration during retention"
```
