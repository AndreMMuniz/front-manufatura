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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
}

async function expectHomeFullWidth(page: Page): Promise<void> {
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
    };
  });

  expect(dimensions.contentLeft).toBe(0);
  expect(Math.abs(dimensions.contentRight - dimensions.viewportWidth)).toBeLessThanOrEqual(1);
  expect(dimensions.toolbarLeft).toBe(0);
  expect(Math.abs(dimensions.toolbarRight - dimensions.viewportWidth)).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
}

test.describe('menu lateral contextual', () => {
  test('não aparece no login nem na Home, que usa toda a largura', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('po-menu')).toHaveCount(0);

    await login(page);
    await expect(page.getByTestId('app-side-menu')).toHaveCount(0);
    await expect(page.locator('po-menu')).toHaveCount(0);
    await expectHomeFullWidth(page);
  });

  test('mostra Menu Principal e os oito módulos em ordem nas telas internas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.getByRole('link', { name: 'Plano Controle CQ' }).click();

    await expect(page).toHaveURL(/\/quality-control$/);
    await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();

    const expectedItems = ['Menu Principal', ...modules.map(module => module.label)];
    const menuItems = page.getByTestId('app-side-menu').getByRole('menuitem');
    await expect(menuItems).toHaveCount(expectedItems.length);
    for (const [index, label] of expectedItems.entries()) {
      await expect(menuItems.nth(index)).toContainText(label);
    }
    await expect(page.getByTestId('app-side-menu').getByText('Sair', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('main-menu-return')).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[data-testid="app-side-menu"] .po-menu');
      const pageElement = document.querySelector<HTMLElement>('.po-page');

      if (!menu || !pageElement) {
        throw new Error('Shell contextual não encontrado.');
      }

      const menuBox = menu.getBoundingClientRect();
      const pageBox = pageElement.getBoundingClientRect();
      return {
        menuRight: menuBox.right,
        pageLeft: pageBox.left,
      };
    });

    expect(layout.pageLeft).toBeGreaterThanOrEqual(layout.menuRight - 1);
    await expect.poll(async () => page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[data-testid="app-side-menu"] .po-menu');
      const toolbar = document.querySelector<HTMLElement>('po-toolbar .po-toolbar');

      if (!menu || !toolbar) {
        throw new Error('Menu ou toolbar contextual não encontrado.');
      }

      return toolbar.getBoundingClientRect().left - menu.getBoundingClientRect().right;
    })).toBeGreaterThanOrEqual(-1);
    await expectNoHorizontalOverflow(page);
  });

  test('navega entre módulos e retorna à Home pelo primeiro item', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.getByRole('link', { name: modules[0].label }).click();

    for (const module of modules) {
      await page.getByTestId('app-side-menu').getByRole('menuitem', { name: module.label }).click();
      await expect(page).toHaveURL(new RegExp(`${module.route.replace('/', '\\/')}$`));
      await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();
    }

    await page.getByTestId('app-side-menu').getByRole('menuitem', { name: 'Menu Principal' }).click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId('app-side-menu')).toHaveCount(0);
    await expectHomeFullWidth(page);
  });

  for (const viewport of [
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'celular', width: 375, height: 812 },
  ]) {
    test(`mantém a navegação contextual utilizável em ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page);
      await page.getByRole('link', { name: 'Plano Controle CQ' }).click();

      await expect(page.getByTestId('app-side-menu')).toBeVisible();
      await page.getByTestId('app-side-menu').locator('.po-menu-mobile').click();
      const homeItem = page.getByTestId('app-side-menu').getByRole('menuitem', { name: 'Menu Principal' });
      await expect(homeItem).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await homeItem.click();
      await expect(page).toHaveURL(/\/menu$/);
      await expect(page.getByTestId('app-side-menu')).toHaveCount(0);
      await expectHomeFullWidth(page);
    });
  }

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
    await expect(page.locator('po-menu')).toHaveCount(0);
  });
});
