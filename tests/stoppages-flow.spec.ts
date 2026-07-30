import { expect, test, type Page } from '@playwright/test';
import { readOperationalOutbox } from './helpers/operational-outbox';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' })
    .fill(process.env['APP_LOGIN_USER'] ?? 'operador');
  await page.getByRole('textbox', { name: 'Senha' })
    .fill(process.env['APP_LOGIN_PASSWORD'] ?? 'mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}

async function openStoppages(page: Page): Promise<void> {
  await login(page);
  await page.getByRole('link', { name: 'Paradas' }).click();
  await expect(page).toHaveURL(/\/stoppages$/);
  await expect(page.getByRole('heading', { name: 'Paradas' })).toBeVisible();
}

async function selectContext(page: Page): Promise<void> {
  const area = page.getByRole('combobox', { name: 'Área de Produção' });
  const center = page.getByRole('combobox', { name: 'Centro de Trabalho' });
  await expect(area).toBeEnabled();
  await expect(center).toBeDisabled();

  await area.focus();
  await area.press('ArrowDown');
  await area.press('Enter');
  await expect(center).toBeEnabled();
  await center.selectOption('CT-EXT-01');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

test.describe('registro de Paradas', () => {
  test.use({ hasTouch: true });

  test('permite acesso direto, seleção por teclado e registro local pendente', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await openStoppages(page);
    await selectContext(page);

    const responsible = page.getByRole('combobox', { name: 'Responsável', exact: true });
    await expect(responsible).toBeEnabled();
    await responsible.selectOption('001');
    await expect(responsible).toContainText('001');
    await page.getByRole('combobox', { name: 'Motivo' }).selectOption('1');
    await page.getByRole('textbox', { name: 'Data Inicial' }).fill('28/07/2026');
    await page.getByRole('textbox', { name: 'Hora Inicial' }).fill('08:00');

    const register = page.getByRole('button', { name: 'Registrar parada' });
    await register.focus();
    await expect(register).toBeFocused();
    expect(await register.evaluate(element => getComputedStyle(element).outlineStyle))
      .not.toBe('none');
    await register.press('Enter');

    await expect(page.locator('.reporte-paradas__success[role="status"]')).toContainText(
      /salva neste dispositivo e pendente de sincronização/i,
    );

    const openStop = page.getByRole('list', {
      name: 'Paradas elegíveis para finalização',
    }).getByRole('button').first();
    await expect(openStop).toBeVisible();
    await openStop.click();
    await page.getByRole('textbox', { name: 'Data da Finalização' }).fill('28/07/2026');
    await page.getByRole('textbox', { name: 'Hora da Finalização' }).fill('09:00');
    await page.getByRole('button', { name: 'Finalizar parada' }).click();
    await expect(page.locator('.reporte-paradas__success[role="status"]')).toContainText(
      /finalização salva neste dispositivo e pendente de sincronização/i,
    );

    const outbox = await readOperationalOutbox(page);
    const create = outbox.find(entry => entry.commandType === 'CREATE_STOP');
    const finish = outbox.find(entry => entry.commandType === 'FINISH_STOP');
    expect(create).toBeDefined();
    expect(finish).toBeDefined();
    expect(finish?.dependencyIds).toEqual([create?.localId]);
    await expect(page.getByRole('combobox', { name: 'Área de Produção' }))
      .toBeEnabled();
    await expectNoHorizontalOverflow(page);
  });

  for (const viewport of [
    { width: 480, height: 900 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
  ]) {
    test(`não cria overflow em ${viewport.width}x${viewport.height} e aceita toque`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openStoppages(page);
      await selectContext(page);

      await expect(page.getByText('Iniciar ou registrar parada')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Voltar' }).tap();
      await expect(page).toHaveURL(/\/menu$/);
    });
  }
});
