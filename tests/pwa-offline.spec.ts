import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const DATABASE_NAME = 'plano-de-controle-operational';

test.beforeEach(async ({ request }) => {
  await selectVersion(request, 'a');
});

test('aquece online e reabre shell/deep link com sessão válida offline', async ({
  context,
  page,
}) => {
  await login(page);
  await waitForController(page);
  await page.goto('/quality-control');
  await expect(page.getByRole('heading', { name: 'Plano Controle CQ', exact: true })).toHaveCount(0);
  await expect(page.locator('.po-toolbar-title')).toBeVisible();
  await expect(page.locator('.po-toolbar-title')).toHaveText('Plano Controle CQ');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plano Controle CQ', exact: true })).toHaveCount(0);
  await expect(page.locator('.po-toolbar-title')).toBeVisible();
  await expect(page.locator('.po-toolbar-title')).toHaveText('Plano Controle CQ');
  await expect(page.getByTestId('offline-banner')).toContainText('Você está offline');

  await page.goto('/menu');
  await expect(page.getByRole('heading', { name: 'Menu Principal' })).toHaveCount(0);
  await expect(page.locator('.po-toolbar-title')).toBeVisible();
  await expect(page.locator('.po-toolbar-title')).toHaveText('Menu Principal');
});

test('recusa login novo e consulta sem cópia local quando offline', async ({
  context,
  page,
}) => {
  await page.goto('/login');
  await waitForController(page);
  await page.evaluate(() => sessionStorage.clear());
  await context.setOffline(true);

  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(
    'A autenticação exige conexão com o Datasul.',
    { exact: true },
  )).toBeVisible();

  await context.setOffline(false);
  await login(page);
  await page.goto('/item-consultation');
  await context.setOffline(true);
  await expect(page.getByText(
    'Dados não disponíveis neste dispositivo. Conecte-se para consultar o Datasul.',
    { exact: true },
  )).toBeVisible();
});

test('não armazena login, POST nem respostas autenticadas no Cache Storage', async ({
  page,
}) => {
  await login(page);
  await waitForController(page);
  const authenticatedResponse = await page.evaluate(async () => {
    const response = await fetch('/api/profile', {
      headers: { Authorization: 'Bearer pwa-e2e-memory-token' },
    });
    return { ok: response.ok, body: await response.json() };
  });
  expect(authenticatedResponse.ok).toBe(true);
  expect(authenticatedResponse.body).toMatchObject({ id: 'USR-PWA-E2E' });

  const cachedRequests = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      urls.push(...(await cache.keys()).map(request => request.url));
    }
    return urls;
  });

  expect(cachedRequests.some(url => url.includes('/api/auth/login'))).toBe(false);
  expect(cachedRequests.some(url => url.includes('/api/'))).toBe(false);
});

test('atualiza A para B e preserva item PENDING byte/logicamente legível', async ({
  page,
  request,
}) => {
  await page.goto('/_test/pwa-offline');
  await waitForController(page);
  await clearDatabase(page);
  await page.reload();
  await page.getByTestId('seed-pending').click();
  const before = await resultJson(page);
  expect(before).toMatchObject({
    version: 'A',
    status: 'PENDING',
    payload: { quantity: 7, note: 'sem segredo' },
  });

  await selectVersion(request, 'b');
  await page.reload();
  const updateNotice = page.getByTestId('pwa-update-notice');
  await expect(updateNotice).toContainText('Uma nova versão está pronta');
  await Promise.all([
    page.waitForEvent('load'),
    updateNotice.getByRole('button', { name: 'Atualizar agora' }).click(),
  ]);

  await expect(page.getByTestId('pwa-version')).toHaveText('B');
  await page.getByTestId('verify-pending').click();
  expect(await resultJson(page)).toEqual({
    version: 'B',
    status: before.status,
    localId: before.localId,
    idempotencyKey: before.idempotencyKey,
    payloadHash: before.payloadHash,
    payload: before.payload,
  });
});

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}

async function waitForController(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload();
  }
  await expect.poll(
    () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBe(true);
}

async function selectVersion(request: APIRequestContext, version: 'a' | 'b'): Promise<void> {
  const response = await request.post(`/__pwa_test/version/${version}`);
  expect(response.ok()).toBe(true);
}

async function clearDatabase(page: Page): Promise<void> {
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

async function resultJson(page: Page): Promise<Record<string, unknown>> {
  await expect(page.getByTestId('pwa-result')).not.toHaveText('');
  return JSON.parse(await page.getByTestId('pwa-result').innerText()) as Record<string, unknown>;
}
