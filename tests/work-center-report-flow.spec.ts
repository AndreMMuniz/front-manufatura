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

async function selectProductionContext(page: import('@playwright/test').Page) {
  const area = page.getByRole('combobox', { name: 'Área de Produção' });
  await expect(area).toBeEnabled();
  await area.selectOption('4001');

  const center = page.getByRole('textbox', { name: 'Centro de Trabalho' });
  await expect(center).toBeEnabled();
  await center.fill('CT-EXT-01');
  await center.press('ArrowDown');
  await center.press('Enter');
  await expect(center).toHaveValue('CT-EXT-01 - Extrusao Linha 01');

  await page.getByRole('button', { name: 'Consultar ordens' }).click();
  await expect(page.getByRole('cell', { name: '450001' })).toBeVisible();
}

async function selectOrderWithKeyboard(page: import('@playwright/test').Page, order: string) {
  const row = page.getByRole('row').filter({ hasText: order });
  const checkbox = row.getByRole('checkbox');
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
}

test.describe('fluxo de Reporte Operações', () => {
  test('navega para Reporta Operação pelo cartão da Home', async ({ page }) => {
    await login(page);

    await expect(page.locator('po-menu')).toHaveCount(0);
    await page.getByRole('link', { name: 'Reporte Operações' }).click();

    await expect(page).toHaveURL(/\/operation-reporting$/);
    await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reporta Operação' })).toBeVisible();
  });

  test('consulta ordens por Área/Centro, seleciona pelo teclado e não cria overflow na página', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page);
    await page.getByRole('link', { name: 'Reporte Operações' }).click();

    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await expect(page.getByRole('button', { name: 'Abrir apontamento' })).toBeEnabled();
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();

    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();
    await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('processa duas ordens selecionadas sequencialmente e atualiza a lista ao final', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Operações' }).click();
    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await selectOrderWithKeyboard(page, '450002');
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();

    await page.getByRole('button', { name: 'Iniciar' }).click();
    const firstQuantity = page.getByRole('spinbutton', { name: 'Qtde Aprovada' });
    await firstQuantity.fill('1');
    await firstQuantity.press('Tab');
    await expect(firstQuantity).toHaveValue('1');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Reportar' }).click();

    await expect(page.getByText(/Ordem ativa 450002/)).toBeVisible();
    await page.getByRole('button', { name: 'Iniciar' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Qtde Aprovada' })).toHaveValue('0');
    const secondQuantity = page.getByRole('spinbutton', { name: 'Qtde Aprovada' });
    await secondQuantity.fill('1');
    await secondQuantity.press('Tab');
    await expect(secondQuantity).toHaveValue('1');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Reportar' }).click();

    await expect(page.getByText('Ordens liberadas', { exact: true })).toBeVisible();
    await expect(page.getByText(/Ordem ativa/)).toHaveCount(0);
    await expect(page).toHaveURL(/\/operation-reporting$/);
  });

  test('restaura a ordem ativa e a fila após abrir Paradas e voltar', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Operações' }).click();
    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();
    await page.getByRole('button', { name: 'Iniciar' }).click();

    await page.getByRole('button', { name: 'Parada' }).click();
    await expect(page).toHaveURL(/\/stoppages$/);
    await page.getByRole('button', { name: 'Voltar' }).click();

    await expect(page).toHaveURL(/\/operation-reporting$/);
    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reportar' })).toBeVisible();
  });

  test('mantém o botão Report visível no Centro de Trabalho e navega após contexto completo', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Centro de Trabalho' }).click();

    await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();
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
    await expect(page.getByRole('combobox', { name: 'Área de Produção' })).toHaveValue('4001 - Produção');
    await expect(page.getByRole('textbox', { name: 'Centro de Trabalho' })).toHaveValue('CT-EXT-01 - Extrusao Linha 01');
    await page.getByRole('button', { name: 'Consultar ordens' }).click();
    await expect(page.getByRole('cell', { name: '450001' })).toBeVisible();
  });
});
