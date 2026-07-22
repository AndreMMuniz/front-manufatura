import { expect, test, type Page } from '@playwright/test';

const credentials = {
  user: 'operador',
  password: 'mock123',
};

const modules = [
  { label: 'Plano Controle CQ', route: '/quality-control' },
  { label: 'Reporte Operações', route: '/operation-reporting' },
  { label: 'Reporte Batelada', route: '/batch-reporting' },
  { label: 'Paradas', route: '/stoppages' },
  { label: 'Refugo / Retrabalho', route: '/scrap-rework' },
  { label: 'Centro de Trabalho', route: '/work-center' },
  { label: 'Operador', route: '/operators' },
  { label: 'Equipes', route: '/teams' },
] as const;

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill(credentials.user);
  await page.getByRole('textbox', { name: 'Senha' }).fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}

async function expectFullWidthWithoutOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => {
    const contentBox = document.querySelector<HTMLElement>('[data-testid="app-content"]')?.getBoundingClientRect();
    const toolbarBox = document.querySelector<HTMLElement>('po-toolbar .po-toolbar')?.getBoundingClientRect();

    if (!contentBox || !toolbarBox) {
      throw new Error('Shell autenticado não encontrado.');
    }

    return {
      contentLeft: contentBox.left,
      contentRight: contentBox.right,
      toolbarLeft: toolbarBox.left,
      toolbarRight: toolbarBox.right,
      viewportWidth: document.documentElement.clientWidth,
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  expect(dimensions.contentLeft).toBe(0);
  expect(Math.abs(dimensions.contentRight - dimensions.viewportWidth)).toBeLessThanOrEqual(1);
  expect(dimensions.toolbarLeft).toBe(0);
  expect(Math.abs(dimensions.toolbarRight - dimensions.viewportWidth)).toBeLessThanOrEqual(1);
  expect(dimensions.hasOverflow).toBe(false);
}

test.describe('shell autenticado sem menu lateral', () => {
  test('não renderiza menu lateral antes nem depois da autenticação', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('po-menu')).toHaveCount(0);

    await login(page);

    await expect(page.locator('po-menu')).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('usa toda a largura em desktop, tablet e celular', async ({ page }) => {
    const viewports = [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
    ];

    await page.setViewportSize(viewports[0]);
    await login(page);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/menu');
      await expect(page).toHaveURL(/\/menu$/);
      await expectFullWidthWithoutOverflow(page);

      await page.getByRole('link', { name: 'Plano Controle CQ' }).click();
      await expect(page.getByTestId('main-menu-return')).toBeVisible();
      await expectFullWidthWithoutOverflow(page);
    }
  });

  test('oferece retorno ao Menu Principal em todas as telas dos módulos', async ({ page }) => {
    await login(page);

    for (const { label, route } of modules) {
      await page.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));

      const returnButton = page.getByTestId('main-menu-return');
      const buttonBox = await returnButton.boundingBox();
      const contentBox = await page.getByTestId('app-content').boundingBox();

      expect(buttonBox).not.toBeNull();
      expect(contentBox).not.toBeNull();
      expect(await returnButton.evaluate(element => getComputedStyle(element).position)).toBe('static');
      expect(buttonBox!.x).toBeGreaterThanOrEqual(contentBox!.x);
      expect(buttonBox!.y).toBeLessThan(160);

      await returnButton.click();
      await expect(page).toHaveURL(/\/menu$/);
    }

    await expect(page.getByTestId('main-menu-return')).toHaveCount(0);
  });

  test('encerra a sessão pela ação Sair do toolbar na Home', async ({ page }) => {
    await login(page);

    const sessionActions = page.getByRole('button', { name: 'Abrir ações da sessão' });
    await sessionActions.focus();
    await expect(sessionActions).toBeFocused();
    await page.keyboard.press('Enter');
    const logoutAction = page.getByText('Sair', { exact: true });
    await expect(logoutAction).toBeVisible();
    await logoutAction.click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Apontamento Manufatura' })).toBeVisible();
    await expect(page.locator('po-toolbar')).toHaveCount(0);
  });
});
