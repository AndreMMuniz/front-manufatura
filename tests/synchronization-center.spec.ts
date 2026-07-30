import { BrowserContext, Page, expect, test } from '@playwright/test';

const DATABASE_NAME = 'plano-de-controle-operational';
const ABANDON_PERMISSION = 'SYNC_UNSYNCHRONIZED_ABANDON';
const OWNER_A = 'operator-sync-a';
const OWNER_B = 'operator-sync-b';

interface SeedEntry {
  readonly localId: string;
  readonly ownerId: string;
  readonly status: 'PENDING' | 'BLOCKED_AUTH' | 'ERROR' | 'SYNCED';
  readonly commandType?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly payload?: Record<string, unknown>;
  readonly occurredAt?: string;
  readonly receipt?: {
    readonly serverRecordId: string;
    readonly receivedAt: string;
    readonly processedAt: string;
    readonly duplicate: boolean;
  };
}

test.beforeEach(async ({ context }) => {
  await mockAuthentication(context);
});

test('indicador abre a Central owner-scoped, preserva reload, teclado, foco e viewports industriais', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto('/synchronization');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fsynchronization$/);
  await login(page, 'owner-a');
  await expect(page).toHaveURL(/\/synchronization$/);

  await seedEntries(page, [
    {
      localId: 'pending-a',
      ownerId: OWNER_A,
      status: 'BLOCKED_AUTH',
      aggregateId: 'OP-100',
      occurredAt: '2026-07-30T12:00:00.000Z',
    },
    {
      localId: 'error-a',
      ownerId: OWNER_A,
      status: 'ERROR',
      aggregateId: 'OP-101',
      occurredAt: '2026-07-30T13:00:00.000Z',
    },
    {
      localId: 'synced-a',
      ownerId: OWNER_A,
      status: 'SYNCED',
      aggregateId: 'OP-099',
      occurredAt: '2026-07-30T11:00:00.000Z',
      receipt: {
        serverRecordId: 'datasul-99',
        receivedAt: '2026-07-30T11:01:00.000Z',
        processedAt: '2026-07-30T11:01:01.000Z',
        duplicate: false,
      },
    },
    {
      localId: 'error-b',
      ownerId: OWNER_B,
      status: 'ERROR',
      aggregateId: 'SEGREDO-OWNER-B',
    },
  ]);
  await invalidateProjection(page);

  const indicator = page.getByTestId('synchronization-indicator').getByRole('button');
  await expect(indicator).toContainText('1 pendências · 1 erros');
  await expect(page.getByTestId('sync-status-error-a')).toContainText(
    'Registro preservado — precisa de atenção',
  );
  await expect(page.getByTestId('business-status-error-a')).toContainText('EM_ANDAMENTO');
  await expect(page.getByText('SEGREDO-OWNER-B')).toHaveCount(0);

  const detailTrigger = page.getByTestId('sync-detail-error-a');
  await detailTrigger.focus();
  await detailTrigger.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Detalhes do registro' })).toBeVisible();
  await page.getByTestId('sync-close-detail').press('Enter');
  await expect(detailTrigger).toBeFocused();

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }

  await page.reload();
  await expect(page.getByTestId('sync-status-error-a')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir ações da sessão' }).click();
  await page.getByText('Sair').click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, 'owner-b');
  await page.goto('/menu');
  await indicatorFor(page).focus();
  await indicatorFor(page).press('Space');
  await expect(page).toHaveURL(/\/synchronization$/);
  await expect(page.getByText('SEGREDO-OWNER-B')).toBeVisible();
  await expect(page.getByTestId('sync-status-error-a')).toHaveCount(0);
});

test('retry, correção e abandono usam a Outbox real e mantêm feedback seguro', async ({ page }) => {
  await page.goto('/login');
  await login(page, 'owner-a');
  await seedEntries(page, [
    { localId: 'retry-a', ownerId: OWNER_A, status: 'ERROR', aggregateId: 'OP-RETRY' },
    {
      localId: 'correct-a',
      ownerId: OWNER_A,
      status: 'ERROR',
      aggregateType: 'STOPPAGE',
      aggregateId: 'STOP-CORRECT',
      commandType: 'CREATE_STOP',
      payload: {
        localId: 'correct-a',
        reason: { id: 1, code: 'PARADA_NAO_PROGRAMADA', description: 'Ajuste' },
        responsible: { tipo: 'OPERADOR', codigo: '001', nome: 'Operador' },
        startDate: '2026-07-30',
        startTime: '08:00',
        programmed: false,
        status: 'EM_ANDAMENTO',
      },
    },
    { localId: 'abandon-a', ownerId: OWNER_A, status: 'ERROR', aggregateId: 'OP-ABANDON' },
    ...Array.from({ length: 30 }, (_, index) => ({
      localId: `queue-${index}`,
      ownerId: OWNER_A,
      status: 'PENDING' as const,
      aggregateId: `QUEUE-${index}`,
    })),
  ]);
  await invalidateProjection(page);
  await indicatorFor(page).click();
  await expect(page).toHaveURL(/\/synchronization$/);

  const retry = page.getByTestId('sync-retry-retry-a');
  const retryStartedAt = Date.now();
  await retry.dblclick();
  await expect(page.getByTestId('sync-action-feedback')).toContainText(
    'preparado para nova tentativa',
  );
  await expect(retry).toBeEnabled();
  expect(Date.now() - retryStartedAt).toBeLessThan(2_000);

  await page.getByTestId('sync-correct-correct-a').click();
  await expect(page).toHaveURL(/\/stoppages$/);
  await expect(page.getByText('Correção de registro preservado')).toBeVisible();
  await selectStoppageContext(page);
  await page.getByRole('combobox', { name: 'Responsável', exact: true }).selectOption('001');
  await page.getByRole('combobox', { name: 'Motivo' }).selectOption('1');
  await selectToday(page, 'Data Inicial');
  await fillTime(page, 'Hora Inicial', '08:10');
  await page.getByRole('button', { name: 'Registrar parada' }).click();
  await expect(page.locator('.reporte-paradas__success[role="status"]')).toContainText(
    /salva neste dispositivo e pendente de sincronização/i,
  );
  const correction = await readSupersession(page, 'correct-a');
  expect(correction.originalDisposition).toBe('SUPERSEDED');
  expect(correction.replacement?.supersedesLocalId).toBe('correct-a');
  expect(correction.replacement?.aggregateId).toBe('STOP-CORRECT');
  expect(correction.replacement?.logicalOccurredAt).toBe(correction.originalOccurredAt);
  await indicatorFor(page).click();
  await expect(page).toHaveURL(/\/synchronization$/);

  const abandon = page.getByTestId('sync-abandon-abandon-a');
  await abandon.focus();
  await abandon.click();
  await expect(page.getByTestId('sync-abandon-dialog')).toContainText(
    'não informe senhas, tokens, credenciais',
  );
  await page.locator('#sync-abandon-reason').fill('Duplicidade validada pelo operador');
  await page.getByTestId('sync-confirm-abandon').dblclick();
  await expect(page.getByTestId('sync-action-feedback')).toContainText(
    'mantido no histórico',
  );
  await expect(page.getByTestId('sync-detail-abandon-a')).toBeFocused();
  await page.locator('#sync-status').selectOption('ABANDONED');
  await page.getByTestId('sync-apply-filters').click();
  await expect(page.getByTestId('sync-status-abandon-a')).toContainText(
    'Abandonado com justificativa',
  );
  expect(await readPairDisposition(page, 'abandon-a')).toEqual(['ABANDONED', 'ABANDONED']);
});

test('abandono é default-deny e apenas uma aba vence a race transacional', async ({
  context,
}) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/login');
  await second.goto('/login');
  await login(first, 'owner-a');
  await login(second, 'owner-a');
  await seedEntries(first, [
    { localId: 'race-a', ownerId: OWNER_A, status: 'ERROR', aggregateId: 'OP-RACE' },
  ]);
  await Promise.all([first.goto('/synchronization'), second.goto('/synchronization')]);

  await first.getByTestId('sync-abandon-race-a').click();
  await second.getByTestId('sync-abandon-race-a').click();
  await first.locator('#sync-abandon-reason').fill('Race confirmada pela primeira aba');
  await second.locator('#sync-abandon-reason').fill('Race confirmada pela segunda aba');
  await Promise.all([
    first.getByTestId('sync-confirm-abandon').click(),
    second.getByTestId('sync-confirm-abandon').click(),
  ]);
  await expect.poll(() => readPairDisposition(first, 'race-a')).toEqual([
    'ABANDONED',
    'ABANDONED',
  ]);

  const denied = await context.newPage();
  await denied.goto('/login');
  await login(denied, 'owner-denied');
  await seedEntries(denied, [
    { localId: 'denied', ownerId: 'operator-denied', status: 'ERROR', aggregateId: 'OP-DENIED' },
  ]);
  await denied.goto('/synchronization');
  await expect(denied.getByTestId('sync-abandon-denied')).toHaveCount(0);
  await expect(denied.getByText(/sessão não possui a permissão homologada/)).toBeVisible();
  expect(await readPairDisposition(denied, 'denied')).toEqual(['ACTIVE', 'ACTIVE']);
});

async function mockAuthentication(context: BrowserContext): Promise<void> {
  await context.route('**/api/auth/login', async route => {
    const body = route.request().postDataJSON() as { login?: string };
    const loginName = body.login ?? '';
    const denied = loginName === 'owner-denied';
    const ownerId = loginName === 'owner-b'
      ? OWNER_B
      : denied
        ? 'operator-denied'
        : OWNER_A;
    await route.fulfill({
      status: 200,
      json: {
        token: `e2e-token-${ownerId}`,
        offlineSessionExpiresAt: new Date(Date.now() + 28_800_000).toISOString(),
        usuario: {
          id: ownerId,
          nome: loginName,
          login: loginName,
          permissoes: denied ? ['MENU_PRINCIPAL'] : ['MENU_PRINCIPAL', ABANDON_PERMISSION],
        },
      },
    });
  });
}

async function login(page: Page, user: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Login' }).fill(user);
  await page.getByRole('textbox', { name: 'Senha' }).fill('e2e-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
}

function indicatorFor(page: Page) {
  return page.getByTestId('synchronization-indicator').getByRole('button');
}

async function invalidateProjection(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('sync-loading')).toHaveCount(0);
}

async function seedEntries(page: Page, entries: readonly SeedEntry[]): Promise<void> {
  await page.evaluate(async ({ databaseName, values }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['localRecords', 'outbox'], 'readwrite');
    const now = '2026-07-30T14:00:00.000Z';
    for (const value of values) {
      const occurredAt = value.occurredAt ?? now;
      const payload = value.payload ?? {
        ordem: value.aggregateId ?? value.localId,
        op: '10',
        split: '1',
        quantidadeAprovada: 5,
      };
      const common = {
        localId: value.localId,
        idempotencyKey: value.localId,
        payloadSchemaVersion: 1,
        aggregateType: value.aggregateType ?? 'OPERATION',
        aggregateId: value.aggregateId ?? value.localId,
        commandType: value.commandType ?? 'REPORT_OPERATION',
        payload,
        canonicalPayload: JSON.stringify(payload),
        payloadHash: `hash-${value.localId}`,
        ownerId: value.ownerId,
        businessStatus: 'EM_ANDAMENTO',
        dependencyIds: [],
        occurredAt,
        logicalOccurredAt: occurredAt,
        createdAt: now,
        updatedAt: now,
        deliveryDisposition: 'ACTIVE',
      };
      transaction.objectStore('localRecords').put({
        ...common,
        databaseVersion: 3,
        initialSyncStatus: 'PENDING',
      });
      transaction.objectStore('outbox').put({
        ...common,
        status: value.status,
        attemptCount: value.status === 'ERROR' ? 2 : 0,
        ...(value.status === 'ERROR'
          ? {
              lastError: {
                code: 'UNSUPPORTED_COMMAND',
                category: 'CONFIGURATION',
                userMessage: 'Adapter Datasul ainda não configurado.',
              },
            }
          : {}),
        ...(value.receipt ? { receipt: value.receipt } : {}),
      });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { databaseName: DATABASE_NAME, values: entries });
}

async function selectStoppageContext(page: Page): Promise<void> {
  const area = page.getByRole('combobox', { name: 'Área de Produção' });
  const center = page.getByRole('combobox', { name: 'Centro de Trabalho' });
  await area.focus();
  await area.press('ArrowDown');
  await area.press('Enter');
  await expect(center).toBeEnabled();
  await center.selectOption('CT-EXT-01');
}

async function selectToday(page: Page, fieldName: string): Promise<void> {
  const field = page.getByRole('textbox', { name: fieldName });
  const datepicker = field.locator('xpath=ancestor::po-datepicker');
  await datepicker.getByRole('button', { name: 'Open calendar' }).click();
  await datepicker.getByRole('button', { name: /Today|Hoje/ })
    .evaluate((button: HTMLButtonElement) => button.click());
}

async function fillTime(page: Page, fieldName: string, value: string): Promise<void> {
  const field = page.getByRole('textbox', { name: fieldName });
  await field.fill(value);
  await field.dispatchEvent('change');
  await field.blur();
}

async function readSupersession(page: Page, originalLocalId: string): Promise<{
  readonly originalDisposition: string;
  readonly originalOccurredAt: string;
  readonly replacement: {
    readonly supersedesLocalId: string;
    readonly aggregateId: string;
    readonly logicalOccurredAt: string;
  } | null;
}> {
  return page.evaluate(async ({ databaseName, originalId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('outbox', 'readonly');
    const entries = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = transaction.objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const original = entries.find(entry => entry['localId'] === originalId)!;
    const replacementEntry =
      entries.find(entry => entry['supersedesLocalId'] === originalId) ?? null;
    return {
      originalDisposition: String(original['deliveryDisposition'] ?? 'ACTIVE'),
      originalOccurredAt: String(original['occurredAt']),
      replacement: replacementEntry
        ? {
            supersedesLocalId: String(replacementEntry['supersedesLocalId']),
            aggregateId: String(replacementEntry['aggregateId']),
            logicalOccurredAt: String(replacementEntry['logicalOccurredAt']),
          }
        : null,
    };
  }, { databaseName: DATABASE_NAME, originalId: originalLocalId });
}

async function readPairDisposition(page: Page, localId: string): Promise<[string, string]> {
  return page.evaluate(async ({ databaseName, id }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['localRecords', 'outbox'], 'readonly');
    const read = (storeName: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = transaction.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    const [local, outbox] = await Promise.all([read('localRecords'), read('outbox')]);
    database.close();
    return [
      String(local['deliveryDisposition'] ?? 'ACTIVE'),
      String(outbox['deliveryDisposition'] ?? 'ACTIVE'),
    ];
  }, { databaseName: DATABASE_NAME, id: localId });
}
