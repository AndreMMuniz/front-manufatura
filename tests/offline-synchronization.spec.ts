import { Page, expect, test } from '@playwright/test';

import type { CommandResult, SyncCommandRequest } from '../src/app/core/offline/models/sync-command';

const DATABASE_NAME = 'plano-de-controle-operational';

test('duas abas fazem envio único, recuperam lease e repetem resposta perdida idempotentemente', async ({
  context,
}) => {
  const receipts = new Map<string, { hash: string; result: CommandResult }>();
  const requests: SyncCommandRequest[] = [];
  const businessCommits = new Map<string, number>();
  const loseFirstResponse = new Set(['sync-lost-key']);

  await context.route('**/__test/offline-sync', async (route) => {
    const request = route.request();
    const command = request.postDataJSON() as SyncCommandRequest;
    expect(request.headers()['idempotency-key']).toBe(command.idempotencyKey);
    requests.push(command);
    const existing = receipts.get(command.idempotencyKey);
    if (existing && existing.hash !== command.payloadHash) {
      await route.fulfill({ status: 422, json: { code: 'IDEMPOTENCY_CONFLICT' } });
      return;
    }
    const result =
      existing?.result ??
      ({
        serverRecordId: `server-${command.localId}`,
        idempotencyKey: command.idempotencyKey,
        receivedAt: new Date().toISOString(),
        processedAt: new Date().toISOString(),
        duplicate: false,
      } satisfies CommandResult);
    if (!existing) {
      receipts.set(command.idempotencyKey, { hash: command.payloadHash, result });
      businessCommits.set(command.idempotencyKey, 1);
    }
    if (loseFirstResponse.delete(command.idempotencyKey)) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 200,
      json: { ...result, duplicate: Boolean(existing) },
    });
  });

  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/_test/offline-synchronization');
  await deleteDatabase(first);
  await first.reload();
  await second.goto('/_test/offline-synchronization');

  await first.getByTestId('seed-single').click();
  await Promise.all([
    first.getByTestId('sync').click(),
    second.getByTestId('sync').click(),
  ]);
  await expect.poll(() => requests.filter((item) => item.localId === 'sync-single').length).toBe(1);
  expect(businessCommits.get('sync-single-key')).toBe(1);

  await first.getByTestId('seed-recovery').click();
  await first.getByTestId('claim-recovery').click();
  await expect(first.getByTestId('sync-result')).toContainText('"held":true');
  await first.close();
  await second.waitForTimeout(250);
  await second.getByTestId('sync').click();
  await expect(second.getByTestId('sync-result')).toContainText(
    '"localId":"sync-recovery","status":"SYNCED"',
  );
  expect(businessCommits.get('sync-recovery-key')).toBe(1);

  await second.getByTestId('seed-lost').click();
  await second.getByTestId('sync').click();
  await expect(second.getByTestId('sync-result')).toContainText(
    '"localId":"sync-lost","status":"RETRY_WAIT"',
  );
  await second.getByTestId('sync').click();
  await expect(second.getByTestId('sync-result')).toContainText(
    '"localId":"sync-lost","status":"SYNCED"',
  );

  const lostRequests = requests.filter((item) => item.localId === 'sync-lost');
  expect(lostRequests).toHaveLength(2);
  expect(lostRequests[1]).toEqual(lostRequests[0]);
  expect(businessCommits.get('sync-lost-key')).toBe(1);
});

async function deleteDatabase(page: Page): Promise<void> {
  await page.evaluate(
    (databaseName) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('database deletion blocked'));
        request.onsuccess = () => resolve();
      }),
    DATABASE_NAME,
  );
}
