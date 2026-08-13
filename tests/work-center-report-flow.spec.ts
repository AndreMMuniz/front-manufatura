import { expect, test } from '@playwright/test';
import { readOperationalOutbox } from './helpers/operational-outbox';
import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

const credentials = {
  user: 'operador',
  password: 'mock123',
};

async function login(page: import('@playwright/test').Page, returnUrl = '/menu') {
  await page.goto(returnUrl === '/menu' ? '/login' : returnUrl);
  await page.getByRole('textbox', { name: 'Login' }).fill(credentials.user);
  await page.getByRole('textbox', { name: 'Senha' }).fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${returnUrl.replace('/', '\\/')}$`));
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
  await expect(checkbox).toBeVisible();
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
}

async function selectOrderWithPointer(page: import('@playwright/test').Page, order: string) {
  const row = page.getByRole('row').filter({ hasText: order });
  const checkbox = row.getByRole('checkbox');
  await checkbox.click();
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
}

async function selectSingleOrderWithKeyboard(page: import('@playwright/test').Page, order: string) {
  const checkbox = page.getByRole('row').filter({ hasText: order }).getByRole('checkbox');
  await expect(checkbox).toBeVisible();
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).toBeChecked();
}

async function selectSingleOrderWithPointer(page: import('@playwright/test').Page, order: string) {
  const checkbox = page.getByRole('row').filter({ hasText: order }).getByRole('checkbox');
  await checkbox.click();
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toBeChecked();
}

async function createTeamFromContext(
  page: import('@playwright/test').Page,
  code: string,
  activation: 'keyboard' | 'touch' = 'keyboard',
) {
  const currentUrl = page.url();
  const trigger = page.getByRole('button', { name: 'Criar ou gerenciar equipe' });
  await expect(trigger).toBeEnabled();
  if (activation === 'keyboard') {
    await trigger.focus();
    await trigger.press('Enter');
  } else {
    await trigger.tap();
  }
  await expect(page).toHaveURL(currentUrl);

  const drawer = page.locator('app-gerenciar-equipe-slide');
  await expect(drawer.getByText('Criar/Gerenciar Equipe')).toBeVisible();
  await drawer.getByRole('textbox', { name: 'Código' }).fill(code);
  await drawer.getByRole('textbox', { name: 'Descrição' }).fill('Equipe E2E');
  await drawer.getByRole('textbox', { name: 'Turno' }).fill('Turno 1');
  const firstMember = drawer.getByRole('checkbox', { name: /001 Jose Ribeiro Neto/ });
  await firstMember.focus();
  await firstMember.press('Space');
  await expect(firstMember).toBeChecked();
  await drawer.getByRole('button', { name: 'Salvar' }).click();
  await expect(drawer.getByText('Criar/Gerenciar Equipe')).toBeHidden();
  await expect(trigger).toBeFocused();
}

test.describe('fluxo de Reporte Ordem', () => {
  test.use({ hasTouch: true });

  test('navega para Reporta Operação pelo cartão da Home', async ({ page }) => {
    await login(page);

    await expect(page.locator('po-menu')).toHaveCount(0);
    await page.getByRole('link', { name: 'Reporte Ordem' }).click();

    await expect(page).toHaveURL(/\/operation-reporting$/);
    await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reporta Operação' })).toBeVisible();
  });

  test('consulta ordens por Área/Centro, seleciona pelo teclado e não cria overflow na página', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page);
    await page.getByRole('link', { name: 'Reporte Ordem' }).click();

    await selectProductionContext(page);
    await selectSingleOrderWithKeyboard(page, '450001');
    await expect(page.getByRole('button', { name: 'Abrir apontamento' })).toBeEnabled();
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();

    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();
    await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('mantém somente uma ordem selecionada antes de abrir o apontamento', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Ordem' }).click();
    await selectProductionContext(page);

    await selectSingleOrderWithKeyboard(page, '450001');
    const firstCheckbox = page.getByRole('row').filter({ hasText: '450001' }).getByRole('checkbox');
    await firstCheckbox.press('Space');
    await expect(firstCheckbox).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Abrir apontamento' })).toBeDisabled();

    await selectSingleOrderWithKeyboard(page, '450001');
    await selectSingleOrderWithPointer(page, '450002');

    await expect(firstCheckbox).not.toBeChecked();
    await expect(page.getByText('1 ordem selecionada')).toBeVisible();
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();
    await expect(page.getByText(/Ordem ativa 450002/)).toBeVisible();
  });

  test('registra reportes parciais e mantém a operação ativa sem ação de encerramento', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Ordem' }).click();
    await selectProductionContext(page);
    await selectSingleOrderWithKeyboard(page, '450001');
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();

    await page.getByRole('combobox', { name: 'Operador' }).selectOption('001');
    await page.getByRole('button', { name: 'Iniciar' }).click();
    await expect(page.getByRole('button', { name: 'Reporte', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Reporte', exact: true }).click();

    const drawer = page.locator('po-page-slide');
    const firstQuantity = drawer.getByRole('spinbutton', { name: 'Qtde Aprovada' });
    await firstQuantity.fill('1');
    await drawer.getByRole('button', { name: 'Salvar reporte' }).click();
    await expect(drawer.getByText('Reportes anteriores')).toBeVisible();
    await expect(drawer.getByText('1,000')).toBeVisible();
    await drawer.getByRole('button', { name: 'Voltar' }).click();

    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();
    await page.getByRole('button', { name: 'Reporte', exact: true }).click();
    await drawer.getByRole('spinbutton', { name: 'Qtde Aprovada' }).fill('2');
    await drawer.getByRole('button', { name: 'Salvar reporte' }).click();
    await expect(drawer.getByText('2,000')).toBeVisible();
    await drawer.getByRole('button', { name: 'Voltar' }).click();

    await page.getByRole('button', { name: 'Reporte', exact: true }).click();
    await drawer.getByRole('spinbutton', { name: 'Qtde Refugo' }).fill('2');
    await drawer.getByRole('button', {
      name: 'Editar Motivo do Retrabalho/Ordem',
    }).click();
    await drawer.getByRole('combobox', { name: 'Motivo da Ordem 450001' }).selectOption('05');
    await drawer.getByRole('spinbutton', {
      name: 'Quantidade do motivo da Ordem 450001',
    }).fill('2');
    await drawer.getByRole('button', { name: 'Adicionar motivo' }).click();
    await expect(drawer.getByRole('list', {
      name: 'Motivos de refugo da Ordem 450001',
    })).toContainText('05 — Borra: 2,000');
    await drawer.getByRole('button', { name: 'Salvar reporte' }).click();
    await expect(drawer.locator('.reporte-slide__reasons')).toContainText('05 - Borra: 2,000');
    await drawer.getByRole('button', { name: 'Voltar' }).click();

    await expect(
      page.locator('app-producao-form').getByRole('spinbutton', { name: 'Qtde Aprovada' }),
    ).toHaveValue('3');
    await expect(
      page.locator('app-producao-form').getByRole('spinbutton', { name: 'Qtde Refugo' }),
    ).toHaveValue('2');
    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Encerrar', exact: true })).toHaveCount(0);

    const outbox = await readOperationalOutbox(page);
    const start = outbox.find(entry => entry.commandType === 'START_OPERATION');
    const reports = outbox.filter(entry => entry.commandType === 'REPORT_OPERATION');
    expect(start).toBeDefined();
    expect(reports).toHaveLength(3);
    expect(new Set(reports.map(entry => entry.idempotencyKey)).size).toBe(3);
    expect(reports.every(entry => entry.dependencyIds.includes(start!.localId))).toBe(true);
  });

  test('exibe Iniciar, Reporte e Parada nas ações e bloqueia responsável após iniciar', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Ordem' }).click();
    await selectProductionContext(page);
    await selectSingleOrderWithKeyboard(page, '450001');
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();

    const actions = page.locator('app-report-actions');
    await expect(actions.getByRole('button')).toHaveCount(3);
    const actionLabels = (await actions.getByRole('button').allTextContents()).map(label => label.trim());
    expect(actionLabels).toEqual(['Iniciar', 'Reporte', 'Parada']);

    const operator = page.getByRole('combobox', { name: 'Operador' });
    await expect(operator).toBeEnabled();
    await operator.selectOption('001');
    await page.getByRole('button', { name: 'Iniciar' }).click();

    await expect(operator).toBeDisabled();
    await expect(actions.getByRole('button', { name: 'Iniciar' })).toBeDisabled();
    await expect(actions.getByRole('button', { name: 'Reporte' })).toBeEnabled();
    await expect(actions.getByRole('button', { name: 'Encerrar' })).toHaveCount(0);
  });

  test('cria equipe por teclado sem perder a ordem e bloqueia a gestão após iniciar', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Ordem' }).click();
    await selectProductionContext(page);
    await selectSingleOrderWithKeyboard(page, '450001');
    await page.getByRole('button', { name: 'Abrir apontamento' }).click();
    await page.getByRole('combobox', { name: 'Reportar por' }).selectOption('EQUIPE');

    await createTeamFromContext(page, 'E2E-ORDEM');

    const team = page.locator('app-operacao-info-card')
      .getByRole('combobox', { name: 'Equipe' });
    await expect(team).toContainText('E2E-ORDEM - Equipe E2E');
    await expect(team).toHaveValue('E2E-ORDEM - Equipe E2E');
    await expect(page.getByText(/Ordem ativa 450001/)).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Criar ou gerenciar equipe' });
    await trigger.tap();
    await page.locator('app-gerenciar-equipe-slide')
      .getByRole('button', { name: 'Voltar' })
      .click();
    await expect(trigger).toBeFocused();
    await expect(team).toHaveValue('E2E-ORDEM - Equipe E2E');

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 1366, height: 768 },
      { width: 480, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBe(true);
      await expect(trigger).toBeVisible();
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    const start = page.getByRole('button', { name: 'Iniciar' });
    await expect(start).toBeEnabled();
    await start.focus();
    await start.press('Enter');
    await expect(
      page.locator('app-report-operacao-page .report-operacao__feedback')
        .filter({ hasText: 'Operação iniciada.' }),
    ).toBeVisible();
    await expect(trigger).toBeDisabled();
  });

  test('mantém o botão Report visível no Centro de Trabalho e navega após contexto completo', async ({ page }) => {
    await login(page, '/work-center');

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

test.describe('fluxo de Reporte Batelada', () => {
  test.use({ hasTouch: true });

  test('consulta, compõe e inicia múltiplas ordens com uma única ação', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page);
    await page.getByRole('link', { name: 'Reporte Batelada' }).click();

    await expect(page).toHaveURL(/\/batch-reporting$/);
    await expect(page.getByRole('heading', { name: 'Reporta Batelada' })).toBeVisible();
    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await selectOrderWithPointer(page, '450002');
    await expect(page.getByText('2 ordem(ns) selecionada(s)')).toBeVisible();
    await page.getByRole('button', { name: 'Abrir batelada' }).click();

    const composition = page.getByRole('table', { name: 'Composição da batelada' });
    await expect(composition.getByRole('row').filter({ hasText: '450001' })).toBeVisible();
    await expect(composition.getByRole('row').filter({ hasText: '450002' })).toBeVisible();

    const responsible = page.getByRole('combobox', { name: 'Responsável' });
    await expect(responsible.getByRole('option', { name: 'Operador — OP-001 - Ana Silva' }))
      .toHaveCount(1);
    await responsible.selectOption({ label: 'Operador — OP-001 - Ana Silva' });
    const start = page.getByRole('button', { name: 'Iniciar' });
    await expect(start).toBeEnabled();
    await start.click();

    await expect(
      page.locator('app-reporta-batelada-page p[role="status"]')
        .filter({ hasText: 'Batelada iniciada com sucesso.' }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Área de Produção' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Centro de Trabalho' })).toBeDisabled();
    await expect(responsible).toBeDisabled();
    await expect(start).toBeDisabled();
    await expect(composition.getByRole('row').filter({ hasText: '450001' })).toBeVisible();
    await expect(composition.getByRole('row').filter({ hasText: '450002' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('salva parciais por ordem e restaura histórico', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page);
    await page.getByRole('link', { name: 'Reporte Batelada' }).click();
    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await selectOrderWithKeyboard(page, '450002');
    await page.getByRole('button', { name: 'Abrir batelada' }).click();
    const responsible = page.getByRole('combobox', { name: 'Responsável' });
    await expect(responsible.getByRole('option', { name: 'Operador — OP-001 - Ana Silva' }))
      .toHaveCount(1);
    await responsible.selectOption({ label: 'Operador — OP-001 - Ana Silva' });
    await page.getByRole('button', { name: 'Iniciar', exact: true }).click();

    const reportAction = page.getByRole('button', { name: 'Reporte', exact: true });
    await expect(reportAction).toBeEnabled();
    await reportAction.click();

    const drawer = page.locator('app-reporte-batelada-slide');
    await drawer.locator('article').filter({ hasText: 'Ordem 450001' })
      .getByRole('spinbutton', { name: 'Qtde Aprovada', exact: true }).fill('1');
    await drawer.locator('article').filter({ hasText: 'Ordem 450002' })
      .getByRole('spinbutton', { name: 'Qtde Aprovada', exact: true }).fill('2');
    await drawer.getByRole('button', { name: 'Salvar reporte', exact: true }).click();
    await expect(drawer.getByText('Reportes anteriores')).toBeVisible();
    await expect(drawer.locator('.batch-report__history-row').filter({ hasText: '450001' })).toHaveCount(1);
    await expect(drawer.locator('.batch-report__history-row').filter({ hasText: '450002' })).toHaveCount(1);

    await drawer.locator('article').filter({ hasText: 'Ordem 450001' })
      .getByRole('spinbutton', { name: 'Qtde Retrabalho', exact: true }).fill('3');
    await drawer.getByRole('button', { name: 'Salvar reporte', exact: true }).click();
    await expect(drawer.locator('.batch-report__history-row').filter({ hasText: '450001' })).toHaveCount(2);
    await drawer.getByRole('button', { name: 'Voltar', exact: true }).click();

    const composition = page.getByRole('table', { name: 'Composição da batelada' });
    await expect(composition.getByRole('row').filter({ hasText: '450001' })).toContainText('4,000');
    await expect(composition.getByRole('row').filter({ hasText: '450002' })).toContainText('2,000');
    await expect(page.getByRole('region', { name: 'Consolidado da batelada' })).toContainText('6,000');

    await reportAction.click();
    await expect(drawer.locator('.batch-report__history-row').filter({ hasText: '450001' })).toHaveCount(2);
    await expect(drawer.locator('.batch-report__history-row').filter({ hasText: '450002' })).toHaveCount(2);

    const outbox = await readOperationalOutbox(page);
    const start = outbox.find(entry => entry.commandType === 'START_BATCH');
    const reports = outbox.filter(entry => entry.commandType === 'REPORT_BATCH');
    expect(start).toBeDefined();
    expect(reports).toHaveLength(2);
    expect(new Set(reports.map(entry => entry.idempotencyKey)).size).toBe(2);
    expect(reports.every(entry => entry.dependencyIds.includes(start!.localId))).toBe(true);

    const drawerContainer = drawer.locator('.po-page-slide-container');
    await page.setViewportSize({ width: 800, height: 800 });
    await expect(drawerContainer).toHaveCSS('width', '640px');

    await page.setViewportSize({ width: 480, height: 800 });
    await expect(drawerContainer).toHaveCSS('width', '480px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await drawer.getByRole('button', { name: 'Voltar', exact: true }).click();
    await page.setViewportSize({ width: 1024, height: 768 });

  });

  test('entra pelo Centro de Trabalho com contexto BATCH preenchido', async ({ page }) => {
    await login(page, '/work-center');
    await page.getByRole('textbox', { name: 'Código' }).fill('CT-EXT-01');
    await page.getByRole('button', { name: 'Consultar' }).click();
    await page.getByRole('textbox', { name: 'Operador', exact: true }).fill('OP-001');
    await page.getByRole('button', { name: 'Validar' }).click();
    await page.getByRole('textbox', { name: 'Validade' }).fill('2026-06-30');
    await page.getByRole('combobox', { name: 'Reporte por' }).selectOption('BATCH');
    await page.getByRole('button', { name: 'Report' }).click();

    await expect(page).toHaveURL(/\/batch-reporting$/);
    await expect(page.getByRole('combobox', { name: 'Área de Produção' }))
      .toHaveValue('4001 - Produção');
    await expect(page.getByRole('combobox', { name: 'Centro de Trabalho' }))
      .toHaveValue('CT-EXT-01 - Extrusao Linha 01');
  });

  test('cria, edita e reabre equipe preservando composição em teclado, toque e viewports', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reporte Batelada' }).click();
    await selectProductionContext(page);
    await selectOrderWithKeyboard(page, '450001');
    await selectOrderWithPointer(page, '450002');
    await page.getByRole('button', { name: 'Abrir batelada' }).click();

    await createTeamFromContext(page, 'E2E-BATCH', 'touch');
    const responsible = page.getByRole('combobox', { name: 'Responsável' });
    await expect(responsible).toContainText('Equipe — E2E-BATCH - Equipe E2E');
    await expect(responsible).toHaveValue('Equipe — E2E-BATCH - Equipe E2E');

    const trigger = page.getByRole('button', { name: 'Criar ou gerenciar equipe' });
    await trigger.tap();
    const drawer = page.locator('app-gerenciar-equipe-slide');
    const existingMode = drawer.getByRole('button', { name: 'Existente' });
    await existingMode.focus();
    await existingMode.press('Enter');
    await drawer.getByRole('combobox', { name: 'Equipe' }).selectOption('E2E-BATCH');
    await drawer.getByRole('checkbox', { name: /001 Jose Ribeiro Neto/ }).uncheck();
    const secondMember = drawer.getByRole('checkbox', { name: /002 Almir Rogerio Bento/ });
    await secondMember.focus();
    await secondMember.press('Space');
    await expect(secondMember).toBeChecked();
    await drawer.getByRole('button', { name: 'Salvar' }).click();
    await expect(drawer.getByText('Criar/Gerenciar Equipe')).toBeHidden();

    await trigger.tap();
    await existingMode.focus();
    await existingMode.press('Enter');
    await drawer.getByRole('combobox', { name: 'Equipe' }).selectOption('E2E-BATCH');
    await expect(drawer.getByRole('checkbox', { name: /001 Jose Ribeiro Neto/ })).not.toBeChecked();
    await expect(drawer.getByRole('checkbox', { name: /002 Almir Rogerio Bento/ })).toBeChecked();
    await drawer.getByRole('button', { name: 'Voltar' }).click();
    await expect(trigger).toBeFocused();
    await expect(responsible).toContainText('Equipe — E2E-BATCH - Equipe E2E');
    await expect(responsible).toHaveValue('Equipe — E2E-BATCH - Equipe E2E');

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 1366, height: 768 },
      { width: 480, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBe(true);
      await expect(trigger).toBeVisible();
    }

    const start = page.getByRole('button', { name: 'Iniciar', exact: true });
    await expect(start).toBeEnabled();
    await start.focus();
    await start.press('Enter');
    await expect(
      page.locator('app-reporta-batelada-page p[role="status"]')
        .filter({ hasText: 'Batelada iniciada com sucesso.' }),
    ).toBeVisible();
    await expect(trigger).toBeDisabled();
  });
});
