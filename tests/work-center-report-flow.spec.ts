import { expect, test } from '@playwright/test';

const credentials = {
  user: 'operador',
  password: 'mock123',
};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill(credentials.user);
  await page.getByRole('textbox', { name: 'Senha' }).fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}

test.describe('fluxo de Reporte Operações', () => {
  test('expõe o menu lateral e navega para Reporta Operação', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('menuitem', { name: 'Reporte Operações' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Reporte Operações' }).click();

    await expect(page).toHaveURL(/\/operation-reporting$/);
    await expect(page.getByRole('heading', { name: 'Reporta Operação' })).toBeVisible();
  });

  test('mantém o botão Report visível no Centro de Trabalho e navega após contexto completo', async ({ page }) => {
    await login(page);
    await page.getByRole('menuitem', { name: 'Centro de Trabalho' }).click();

    await expect(page.getByRole('button', { name: 'Report' })).toBeVisible();
    await page.getByRole('button', { name: 'Report' }).click();
    await expect(page.getByText('Complete Centro de Trabalho, Operador e Validade para acessar o Report.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Código' }).fill('CT-EXT-01');
    await page.getByRole('button', { name: 'Consultar' }).click();
    await page.getByRole('textbox', { name: 'Operador', exact: true }).fill('OP-001');
    await page.getByRole('button', { name: 'Validar' }).click();
    await page.getByRole('textbox', { name: 'Validade' }).fill('2026-06-30');
    await page.getByRole('button', { name: 'Report' }).click();

    await expect(page).toHaveURL(/\/operation-reporting$/);
    await expect(page.getByRole('heading', { name: 'Reporta Operação' })).toBeVisible();
  });
});
