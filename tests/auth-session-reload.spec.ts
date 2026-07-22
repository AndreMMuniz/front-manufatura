import { expect, test } from '@playwright/test';

test('mantém a sessão e a rota atual ao recarregar uma página protegida', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill(process.env['APP_LOGIN_USER'] ?? 'operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill(process.env['APP_LOGIN_PASSWORD'] ?? 'mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);

  await page.goto('/quality-control');
  await expect(page.getByRole('heading', { name: 'Plano de Controle CQ' })).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(/\/quality-control$/);
  await expect(page.getByRole('heading', { name: 'Plano de Controle CQ' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Login' })).toHaveCount(0);
});
