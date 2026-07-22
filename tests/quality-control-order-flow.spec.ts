import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/quality-control$/);
}

test.describe('fluxo de Ordem do Plano Controle CQ', () => {
  test('consulta a Ordem, seleciona uma operação e gera o roteiro', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('textbox', { name: 'Ordem' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'OP' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Split' })).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
    await page.getByRole('button', { name: 'Consultar Ordem' }).click();

    const operation = page.getByRole('option', { name: /10.*Cortar chapa/ });
    await expect(operation).toBeVisible();
    await expect(page.getByRole('option', { name: /20.*Dobrar chapa/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /30.*Soldar/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeDisabled();

    await operation.click();

    await expect(operation).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('10 - Cortar chapa', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeEnabled();

    await page.getByRole('button', { name: 'Gerar Roteiro' }).click();

    await expect(page).toHaveURL(/\/quality-control\/inspection$/);
    await expect(
      page.getByRole('heading', { name: 'Execução do roteiro de inspeção' }),
    ).toBeVisible();
    await expect(page.getByText('500517')).toBeVisible();
    await expect(page.getByText('Frequência', { exact: true })).toBeVisible();
    await expect(page.getByText('2', { exact: true })).toBeVisible();
    await expect(page.getByText('Amostra', { exact: true })).toBeVisible();
    await expect(page.getByText('1 pc', { exact: true })).toBeVisible();
  });

  test('mantém a seleção de operações utilizável em viewport móvel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
    await page.getByRole('button', { name: 'Consultar Ordem' }).click();
    await page.getByRole('option', { name: /30.*Soldar/ }).click();

    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeEnabled();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
