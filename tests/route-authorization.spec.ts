import { expect, test, type Page } from '@playwright/test';

import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

test('consulta duas fichas, cancela e finaliza somente após confirmação', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await login(page, 'autorizador');
  await page.getByRole('link', { name: 'Autoriza Roteiro CQ' }).click();

  await page.getByRole('textbox', { name: 'Ordem de produção' }).fill('372562');
  await page.getByRole('textbox', { name: 'Operação' }).fill('10');
  await page.getByRole('button', { name: 'Consultar' }).click();

  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByText('64382', { exact: true })).toBeVisible();
  await expect(page.getByText('64442', { exact: true })).toBeVisible();

  await page.getByRole('article').first().getByRole('button', { name: 'Analisar e finalizar' }).click();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);

  await page.getByRole('article').first().getByRole('button', { name: 'Analisar e finalizar' }).click();
  await page.getByRole('button', { name: 'Finalizar com autorização' }).click();
  await expect(page.locator('.route-authorization__feedback'))
    .toContainText('Roteiro 64382 finalizado com AUTORIZACAO');
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('nega deep link para usuário sem fcq-0002', async ({ page }) => {
  await page.goto('/quality-control/route-authorization');
  await page.getByRole('textbox', { name: 'Login' }).fill('sem-autorizacao');
  await page.getByRole('textbox', { name: 'Senha' }).fill('senha-e2e');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/menu\?accessDenied=1$/);
  await expect(page.getByRole('link', { name: 'Autoriza Roteiro CQ' })).toHaveCount(0);
});

test('exibe estado vazio e permite repetir a consulta depois de uma falha', async ({ page }) => {
  await login(page, 'autorizador');
  await page.getByRole('link', { name: 'Autoriza Roteiro CQ' }).click();
  await page.getByRole('textbox', { name: 'Ordem de produção' }).fill('1');
  await page.getByRole('textbox', { name: 'Operação' }).fill('1');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText('Nenhum roteiro pendente foi encontrado')).toBeVisible();

  await page.route('**/api/quality-control/route-authorizations?*', async route => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'datasul-unavailable' }),
    });
  }, { times: 1 });
  await page.getByRole('textbox', { name: 'Ordem de produção' }).fill('372562');
  await page.getByRole('textbox', { name: 'Operação' }).fill('10');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByText('Não foi possível consultar os roteiros')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
});

test('não cria overflow horizontal em viewport móvel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'autorizador');
  await page.getByRole('link', { name: 'Autoriza Roteiro CQ' }).click();
  await page.getByRole('textbox', { name: 'Ordem de produção' }).fill('372562');
  await page.getByRole('textbox', { name: 'Operação' }).fill('10');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);

  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

async function login(page: Page, login: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill(login);
  await page.getByRole('textbox', { name: 'Senha' }).fill('senha-e2e');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}
