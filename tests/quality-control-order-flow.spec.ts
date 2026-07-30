import { expect, test } from '@playwright/test';
import { readOperationalOutbox } from './helpers/operational-outbox';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await page.getByRole('link', { name: 'Plano Controle CQ' }).click();
  await expect(page).toHaveURL(/\/quality-control$/);
}

test.describe('workspace unificado do Plano Controle CQ', () => {
  test('mantém contexto, inspeção e digitação na mesma URL e salva uma medição', async ({ page }) => {
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
    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toHaveCount(0);

    await operation.click();

    await expect(operation).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('10 - Cortar chapa', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeEnabled();

    await page.getByRole('button', { name: 'Gerar Roteiro' }).click();

    await expect(page).toHaveURL(/\/quality-control$/);
    await expect(
      page.getByRole('heading', { name: 'Execução do roteiro de inspeção' }),
    ).toBeVisible();
    await expect(page.getByText('500517')).toBeVisible();
    await expect(page.getByText('Frequência: 00:02 h')).toBeVisible();
    await expect(page.getByText('Amostra: 1 pc')).toBeVisible();
    await expect(page.getByText('325571', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Digitar medição' }).click();
    await expect(page.getByRole('heading', { name: 'Registro das medições' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Execução do roteiro de inspeção' })).toBeVisible();
    await expect(page).toHaveURL(/\/quality-control$/);

    const minimum = page.getByRole('textbox', { name: 'Min' });
    const maximum = page.getByRole('textbox', { name: 'Max' });
    await minimum.fill('484');
    await maximum.fill('490');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(
      page.getByRole('button', { name: /010.*Valores fora da variação permitida/ }),
    ).toBeVisible();
    await expect(page.getByText('1 de 3 componentes concluídos')).toBeVisible();
    await expect(page.getByText('Característica 2 / 3')).toBeVisible();

    await minimum.fill('254,5');
    await maximum.fill('255,5');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Salvo neste dispositivo — envio pendente.')).toBeVisible();
    await expect(page.getByText('2 de 3 componentes concluídos')).toBeVisible();
    await expect(page).toHaveURL(/\/quality-control$/);

    const outbox = await readOperationalOutbox(page);
    const route = outbox.find(entry => entry.commandType === 'GENERATE_INSPECTION_ROUTE');
    const measurements = outbox.filter(entry => entry.commandType === 'SAVE_MEASUREMENT');
    expect(route).toBeDefined();
    expect(measurements).toHaveLength(2);
    expect(new Set(measurements.map(entry => entry.idempotencyKey)).size).toBe(2);
    expect(measurements.every(entry => entry.dependencyIds.includes(route!.localId))).toBe(true);
  });

  for (const viewport of [
    { name: 'móvel', width: 390, height: 844 },
    { name: 'tablet', width: 1024, height: 768 },
  ]) {
    test(`não cria overflow horizontal em viewport ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page);

      await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
      await page.getByRole('button', { name: 'Consultar Ordem' }).click();
      await page.getByRole('option', { name: /30.*Soldar/ }).click();

      await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeEnabled();
      await page.getByRole('button', { name: 'Gerar Roteiro' }).click();
      await page.getByRole('button', { name: 'Digitar medição' }).click();

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});
