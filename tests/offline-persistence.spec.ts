import { expect, test } from '@playwright/test';

const DATABASE_NAME = 'plano-de-controle-operational';

test('a infraestrutura real preserva commit, abort, reload e upgrade/versionchange', async ({
  page,
}) => {
  await page.goto('/login');
  await deleteDatabase();
  await page.goto('/_test/offline-persistence');

  await page.getByTestId('persist-command').click();
  await expect(page.getByTestId('harness-result')).toContainText('"committed":true');
  await expect(page.getByTestId('harness-result')).toContainText('"status":"PENDING"');

  await page.reload();
  await page.getByTestId('verify-storage').click();

  await expect(page.getByTestId('harness-result')).toContainText('"recoveredStatus":"PENDING"');
  await expect(page.getByTestId('harness-result')).toContainText(
    '"recoveredPayload":{"quantity":5}',
  );
  await expect(page.getByTestId('harness-result')).toContainText('"abortCode":"CONSTRAINT"');
  await expect(page.getByTestId('harness-result')).toContainText('"rolledBack":null');
  await expect(page.getByTestId('harness-result')).toContainText(
    '"receivedVersionChange":true',
  );
  await expect(page.getByTestId('harness-result')).toContainText('"version":2');
  await expect(page.getByTestId('harness-result')).toContainText('"hasProbe":true');
  await expect(page.getByTestId('harness-result')).toContainText('"pendingPreserved":true');

  await deleteDatabase();

  async function deleteDatabase(): Promise<void> {
    await page.evaluate(
      (databaseName) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onblocked = () => reject(new Error('database deletion blocked'));
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        }),
      DATABASE_NAME,
    );
  }
});
