import { expect, test, type Locator, type Page } from '@playwright/test';
import { readOperationalOutbox } from './helpers/operational-outbox';
import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador-e2e');
  await page.getByRole('textbox', { name: 'Senha' }).fill('senha-e2e');
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
  const area = page.getByRole('textbox', { name: 'Área de Produção' });
  const center = page.getByRole('combobox', { name: 'Centro de Trabalho' });
  await expect(area).toBeEnabled();
  await expect(center).toBeDisabled();

  await area.fill('4001');
  await area.blur();
  await expect(center).toBeEnabled();
  await center.selectOption('CT-EXT-01');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

async function selectToday(page: Page, fieldName: string): Promise<void> {
  const field = page.getByRole('textbox', { name: fieldName });
  const datepicker = field.locator('xpath=ancestor::po-datepicker');
  await datepicker.getByRole('button', { name: 'Open calendar' }).click();
  await datepicker.getByRole('button', { name: /Today|Hoje/ })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(field).not.toHaveValue('');
}

async function fillTime(page: Page, fieldName: string, value: string): Promise<void> {
  const field = page.getByRole('textbox', { name: fieldName });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await field.fill(value);
    await field.dispatchEvent('change');
    await field.blur();
    if (await field.inputValue() === value) {
      return;
    }
  }
  await expect(field).toHaveValue(value);
}

async function registerOpenStop(page: Page, startTime = '08:00') {
  const responsible = page.getByRole('combobox', { name: 'Responsável', exact: true });
  await expect(responsible).toBeEnabled();
  await responsible.selectOption('001');
  await page.getByRole('combobox', { name: 'Motivo' }).selectOption('1');
  await selectToday(page, 'Data Inicial');
  await fillTime(page, 'Hora Inicial', startTime);
  await page.getByRole('button', { name: 'Registrar parada' }).click();
  await expect(page.locator('.reporte-paradas__success[role="status"]')).toContainText(
    /salva neste dispositivo e pendente de sincronização/i,
  );
  return page.getByRole('list', {
    name: 'Paradas elegíveis para finalização',
  }).getByRole('button').first();
}

async function finalizeOpenStop(page: Page, openStop: Locator): Promise<void> {
  await openStop.click();
  await selectToday(page, 'Data da Finalização');
  await fillTime(page, 'Hora da Finalização', '09:00');
  await page.getByRole('button', { name: 'Finalizar parada' }).click();
}

async function openOperationOrigin(page: Page): Promise<void> {
  await login(page);
  await page.getByRole('link', { name: 'Reporte Ordem' }).click();
  await page.getByRole('combobox', { name: 'Área de Produção' }).selectOption('4001');
  await page.getByRole('combobox', { name: 'Centro de Trabalho' }).selectOption('CT-EXT-01');
  await page.getByRole('button', { name: 'Consultar ordens' }).click();
  const order = page.getByRole('row').filter({ hasText: '450001' }).getByRole('checkbox');
  await order.check();
  await page.getByRole('button', { name: 'Abrir apontamento' }).click();
  await page.getByRole('combobox', { name: 'Operador' }).selectOption('001');
  await page.getByRole('button', { name: 'Iniciar' }).click();
  await page.getByRole('button', { name: 'Parada' }).click();
  await expect(page).toHaveURL(/\/stoppages$/);
}

async function openBatchOrigin(page: Page): Promise<void> {
  await login(page);
  await page.getByRole('link', { name: 'Reporte Batelada' }).click();
  await page.getByRole('combobox', { name: 'Área de Produção' }).selectOption('4001');
  await page.getByRole('combobox', { name: 'Centro de Trabalho' }).selectOption('CT-EXT-01');
  await page.getByRole('button', { name: 'Consultar ordens' }).click();
  await page.getByRole('row').filter({ hasText: '450001' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Abrir batelada' }).click();
  await page.getByRole('combobox', { name: 'Responsável' })
    .selectOption({ label: 'Operador — OP-001 - Ana Silva' });
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await page.getByRole('button', { name: 'Parada' }).click();
  await expect(page).toHaveURL(/\/stoppages$/);
}

test.describe('registro de Paradas', () => {
  test.use({ hasTouch: true });

  test('finaliza pelo contexto com a ação ao lado de Registrar parada', async ({ page }) => {
    await openStoppages(page);
    await selectContext(page);
    await selectToday(page, 'Data Final');
    await fillTime(page, 'Hora Final', '09:40');
    const register = page.getByRole('button', { name: 'Registrar parada' });
    const finish = page.getByRole('button', { name: 'Finalizar parada' });
    const registerBox = await register.boundingBox();
    const finishBox = await finish.boundingBox();

    expect(registerBox).not.toBeNull();
    expect(finishBox).not.toBeNull();
    expect(Math.abs(registerBox!.y - finishBox!.y)).toBeLessThan(4);
    expect(finishBox!.x).toBeGreaterThan(registerBox!.x);

    await finish.click();

    await expect(page.locator('.reporte-paradas__success[role="status"]')).toContainText(
      /finalização.*pendente de sincronização/i,
    );
    const finishCommand = (await readOperationalOutbox(page))
      .find(entry => entry.commandType === 'FINISH_STOP');
    expect(finishCommand?.payload).toEqual(expect.objectContaining({
      areaCode: '4001',
      workCenterCode: 'CT-EXT-01',
      endDate: expect.any(String),
      endTime: '09:40',
    }));
    expect(finishCommand?.payload).not.toHaveProperty('stopLocalId');
  });

  test('permite acesso direto, seleção por teclado e registro local pendente', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await openStoppages(page);
    await selectContext(page);
    await expect(page.getByText('Nenhuma parada em andamento neste contexto.')).toBeVisible();

    const register = page.getByRole('button', { name: 'Registrar parada' });
    const responsible = page.getByRole('combobox', { name: 'Responsável', exact: true });
    await responsible.selectOption('001');
    await page.getByRole('combobox', { name: 'Motivo' }).selectOption('1');
    await selectToday(page, 'Data Inicial');
    await fillTime(page, 'Hora Inicial', '08:00');
    await register.focus();
    await expect(register).toBeFocused();
    expect(await register.evaluate(element => getComputedStyle(element).outlineStyle))
      .not.toBe('none');
    await register.click();

    await expect(page.locator('.reporte-paradas__success[role="status"]')).toContainText(
      /salva neste dispositivo e pendente de sincronização/i,
    );

    const openStop = page.getByRole('list', {
      name: 'Paradas elegíveis para finalização',
    }).getByRole('button').first();
    await expect(openStop).toBeVisible();
    await openStop.focus();
    await openStop.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Data da Finalização' })).toBeFocused();
    await selectToday(page, 'Data da Finalização');
    await fillTime(page, 'Hora da Finalização', '07:59');
    await expect(page.locator('.finish-stop__error[role="alert"]'))
      .toContainText('anterior ao início');
    await fillTime(page, 'Hora da Finalização', '08:00');
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

  test('seleciona parada por toque e mantém o alvo acessível', async ({ page }) => {
    await openStoppages(page);
    await selectContext(page);
    const openStop = await registerOpenStop(page);

    await openStop.tap();

    await expect(page.getByText('Finalizar Parada', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Data da Finalização' })).toBeFocused();
  });

  test('distingue erro de consulta e permite retry até o estado vazio', async ({ page }) => {
    await openStoppages(page);
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.index;
      let failNextLocalRead = true;
      Object.defineProperty(IDBObjectStore.prototype, 'index', {
        configurable: true,
        value(this: IDBObjectStore, name: string): IDBIndex {
          if (failNextLocalRead && this.name === 'localRecords' && name === 'ownerId') {
            failNextLocalRead = false;
            throw new DOMException('Falha E2E transitória', 'UnknownError');
          }
          return original.call(this, name);
        },
      });
    });
    await selectContext(page);

    await expect(page.locator('.open-stops__state--error[role="alert"]'))
      .toContainText('Não foi possível consultar');
    await page.getByRole('button', { name: 'Tentar novamente' }).click();

    await expect(page.getByText('Nenhuma parada em andamento neste contexto.')).toBeVisible();
  });

  test('finaliza e restaura o snapshot de Reporte Ordem', async ({ page }) => {
    await openOperationOrigin(page);
    await expect(page.getByRole('combobox', { name: 'Área de Produção' })).toHaveValue(/4001/);
    const openStop = await registerOpenStop(page);

    await finalizeOpenStop(page, openStop);

    await expect(page).toHaveURL(/\/operation-reporting$/);
    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reporte', exact: true })).toBeEnabled();
  });

  test('finaliza e restaura composição de Reporte Batelada', async ({ page }) => {
    await openBatchOrigin(page);
    await expect(page.getByRole('combobox', { name: 'Centro de Trabalho' })).toHaveValue(/CT-EXT-01/);
    const openStop = await registerOpenStop(page);

    await finalizeOpenStop(page, openStop);

    await expect(page).toHaveURL(/\/batch-reporting$/);
    await expect(page.getByRole('table', { name: 'Composição da batelada' })
      .getByRole('row').filter({ hasText: '450001' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reporte', exact: true })).toBeEnabled();
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
