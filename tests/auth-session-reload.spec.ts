import { expect, test } from '@playwright/test';
import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

test('mantém a sessão e a rota atual ao recarregar uma página protegida', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador-e2e');
  await page.getByRole('textbox', { name: 'Senha' }).fill('senha-e2e');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);

  await page.goto('/quality-control');
  await expect(page.getByRole('heading', { name: 'Plano Controle CQ', exact: true })).toHaveCount(0);
  await expect(page.locator('.po-toolbar-title')).toBeVisible();
  await expect(page.locator('.po-toolbar-title')).toHaveText('Plano Controle CQ');
  await expect(page.getByRole('heading', { name: 'Plano de Controle CQ', exact: true })).toHaveCount(0);

  await page.reload();

  await expect(page).toHaveURL(/\/quality-control$/);
  await expect(page.getByRole('heading', { name: 'Plano Controle CQ', exact: true })).toHaveCount(0);
  await expect(page.locator('.po-toolbar-title')).toBeVisible();
  await expect(page.locator('.po-toolbar-title')).toHaveText('Plano Controle CQ');
  await expect(page.getByRole('heading', { name: 'Plano de Controle CQ', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Login' })).toHaveCount(0);
});
