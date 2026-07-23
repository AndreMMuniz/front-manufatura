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

  const center = page.getByRole('combobox', { name: 'Centro de Trabalho' });
  await expect(center).toBeEnabled();
  await center.selectOption('CT-EXT-01');
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

  test('registra reportes parciais, mantém histórico e só avança ao encerrar', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Operações' }).click();
    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await selectOrderWithKeyboard(page, '450002');
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();

    await page.getByRole('combobox', { name: 'Operador' }).selectOption('001');
    await page.getByRole('button', { name: 'Iniciar' }).click();
    await expect(page.getByRole('button', { name: 'Reporte' })).toBeEnabled();
    await page.getByRole('button', { name: 'Reporte' }).click();

    const drawer = page.locator('po-page-slide');
    const firstQuantity = drawer.getByRole('spinbutton', { name: 'Qtde Aprovada' });
    await firstQuantity.fill('1');
    await drawer.getByRole('button', { name: 'Salvar reporte' }).click();
    await expect(drawer.getByText('Reportes anteriores')).toBeVisible();
    await expect(drawer.getByText('1,000')).toBeVisible();
    await drawer.getByRole('button', { name: 'Voltar' }).click();

    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();
    await page.getByRole('button', { name: 'Reporte' }).click();
    await drawer.getByRole('spinbutton', { name: 'Qtde Aprovada' }).fill('2');
    await drawer.getByRole('button', { name: 'Salvar reporte' }).click();
    await expect(drawer.getByText('2,000')).toBeVisible();
    await drawer.getByRole('button', { name: 'Voltar' }).click();

    await page.getByRole('button', { name: 'Encerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Encerrar', exact: true }).last().click();
    await expect(page.getByText(/Ordem ativa 450002/)).toBeVisible();

    await page.getByRole('combobox', { name: 'Operador' }).selectOption('001');
    await page.getByRole('button', { name: 'Iniciar' }).click();
    await page.getByRole('button', { name: 'Reporte' }).click();
    await drawer.getByRole('spinbutton', { name: 'Qtde Aprovada' }).fill('1');
    await drawer.getByRole('button', { name: 'Salvar reporte' }).click();
    await drawer.getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('button', { name: 'Encerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Encerrar', exact: true }).last().click();

    await expect(page.getByText('Ordens liberadas', { exact: true })).toBeVisible();
    await expect(page.getByText(/Ordem ativa/)).toHaveCount(0);
    await expect(page).toHaveURL(/\/operation-reporting$/);
  });

  test('exibe somente Iniciar, Reporte e Encerrar nas ações e bloqueia responsável após iniciar', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Operações' }).click();
    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();

    const actions = page.locator('app-report-actions');
    await expect(actions.getByRole('button')).toHaveCount(3);
    const actionLabels = (await actions.getByRole('button').allTextContents()).map(label => label.trim());
    expect(actionLabels).toEqual(expect.arrayContaining(['Iniciar', 'Reporte', 'Encerrar']));

    const operator = page.getByRole('combobox', { name: 'Operador' });
    await expect(operator).toBeEnabled();
    await operator.selectOption('001');
    await page.getByRole('button', { name: 'Iniciar' }).click();

    await expect(operator).toBeDisabled();
    await expect(actions.getByRole('button', { name: 'Iniciar' })).toBeDisabled();
    await expect(actions.getByRole('button', { name: 'Reporte' })).toBeEnabled();
    await expect(actions.getByRole('button', { name: 'Encerrar' })).toBeEnabled();
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
    await expect(page.getByRole('combobox', { name: 'Centro de Trabalho' })).toHaveValue('CT-EXT-01 - Extrusao Linha 01');
    await page.getByRole('button', { name: 'Consultar ordens' }).click();
    await expect(page.getByRole('cell', { name: '450001' })).toBeVisible();
  });
});
