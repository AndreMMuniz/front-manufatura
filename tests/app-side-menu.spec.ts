import { expect, test, type Page } from '@playwright/test';
import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

const credentials = {
  user: 'operador',
  password: 'mock123',
};

const modules = [
  { label: 'Plano Controle CQ', route: '/quality-control' },
  { label: 'Reporte Ordem', route: '/operation-reporting' },
  { label: 'Reporte Batelada', route: '/batch-reporting' },
  { label: 'Paradas', route: '/stoppages' },
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

async function expectSeparatedToolbarContent(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('.po-toolbar-title');
    const identity = document.querySelector<HTMLElement>('[data-testid="session-identity"]');
    const synchronization = document.querySelector<HTMLElement>('[data-testid="synchronization-indicator"]');
    const actions = document.querySelector<HTMLElement>('button[aria-label="Abrir ações da sessão"]');

    if (!title || !identity || !synchronization || !actions) {
      throw new Error('Conteúdo completo do toolbar não encontrado.');
    }

    return {
      title: title.getBoundingClientRect().toJSON(),
      identity: identity.getBoundingClientRect().toJSON(),
      synchronization: synchronization.getBoundingClientRect().toJSON(),
      actions: actions.getBoundingClientRect().toJSON(),
    };
  });

  expect(layout.title.right).toBeLessThanOrEqual(layout.identity.left + 1);
  expect(layout.identity.right).toBeLessThanOrEqual(layout.synchronization.left + 1);
  expect(layout.synchronization.right).toBeLessThanOrEqual(layout.actions.left + 1);
  expect(layout.identity.width).toBeGreaterThan(0);
  expect(layout.synchronization.width).toBeGreaterThan(0);
  expect(layout.actions.width).toBeGreaterThanOrEqual(44);
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
    await page.setViewportSize({ width: 1900, height: 1017 });
    await page.goto('/login');
    await expect(page.locator('po-menu')).toHaveCount(0);

    const loginLayout = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.app-shell');
      const loginPage = document.querySelector<HTMLElement>('.login-page');
      const loginPanel = document.querySelector<HTMLElement>('.login-page__panel');

      if (!shell || !loginPage || !loginPanel) {
        throw new Error('Estrutura da tela de login não encontrada.');
      }

      const shellBox = shell.getBoundingClientRect();
      const pageBox = loginPage.getBoundingClientRect();
      const panelBox = loginPanel.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;

      return {
        shellRight: shellBox.right,
        pageRight: pageBox.right,
        panelCenter: panelBox.left + panelBox.width / 2,
        viewportCenter: viewportWidth / 2,
        viewportWidth,
      };
    });

    expect(Math.abs(loginLayout.shellRight - loginLayout.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(loginLayout.pageRight - loginLayout.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(loginLayout.panelCenter - loginLayout.viewportCenter)).toBeLessThanOrEqual(1);

    await login(page);
    await expect(page.getByTestId('app-side-menu')).toHaveCount(0);
    await expect(page.locator('po-menu')).toHaveCount(0);
    await expectHomeFullWidth(page);
  });

  test('mostra Menu Principal e somente os módulos aprovados em ordem nas telas internas', async ({ page }) => {
    await page.setViewportSize({ width: 1900, height: 1017 });
    await login(page);
    await page.getByRole('link', { name: 'Plano Controle CQ' }).click();

    await expect(page).toHaveURL(/\/quality-control$/);
    await expect(page.getByTestId('app-side-menu').locator('.po-menu')).toBeVisible();
    await expect(page.locator('.po-toolbar-title')).toContainText('Plano Controle CQ');
    await expect(page.getByTestId('session-identity'))
      .toHaveText('Apontamento Manufatura — operador');

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
      const workspace = document.querySelector<HTMLElement>('.quality-workspace');

      if (!menu || !pageElement || !workspace) {
        throw new Error('Shell contextual não encontrado.');
      }

      const menuBox = menu.getBoundingClientRect();
      const pageBox = pageElement.getBoundingClientRect();
      const workspaceBox = workspace.getBoundingClientRect();
      return {
        menuRight: menuBox.right,
        pageLeft: pageBox.left,
        pageRight: pageBox.right,
        viewportRight: document.documentElement.clientWidth,
        workspaceWidth: workspaceBox.width,
        workspaceLeftGap: workspaceBox.left - menuBox.right,
        workspaceRightGap: document.documentElement.clientWidth - workspaceBox.right,
      };
    });

    expect(layout.pageLeft).toBeGreaterThanOrEqual(layout.menuRight - 1);
    expect(Math.abs(layout.pageRight - layout.viewportRight)).toBeLessThanOrEqual(1);
    expect(layout.workspaceWidth).toBeLessThanOrEqual(1200);
    expect(Math.abs(layout.workspaceLeftGap - layout.workspaceRightGap)).toBeLessThanOrEqual(2);
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

  test('estende toolbar e página até a borda direita na Central de Sincronização', async ({ page }) => {
    await login(page);
    await page.goto('/synchronization');
    await expect(page).toHaveURL(/\/synchronization$/);

    for (const width of [1024, 1280, 1366, 1520, 1900]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const toolbar = document.querySelector<HTMLElement>('po-toolbar .po-toolbar');
        const pageElement = document.querySelector<HTMLElement>('.po-page');

        if (!toolbar || !pageElement) {
          throw new Error('Toolbar ou página da Central de Sincronização não encontrada.');
        }

        return {
          toolbarRight: toolbar.getBoundingClientRect().right,
          pageRight: pageElement.getBoundingClientRect().right,
          viewportRight: document.documentElement.clientWidth,
        };
      });

      expect(Math.abs(layout.toolbarRight - layout.viewportRight), `toolbar em ${width}px`)
        .toBeLessThanOrEqual(1);
      expect(Math.abs(layout.pageRight - layout.viewportRight), `página em ${width}px`)
        .toBeLessThanOrEqual(1);
      await expectNoHorizontalOverflow(page);
    }
  });

  test('acompanha a largura do menu ao recolher e expandir', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.getByRole('link', { name: 'Plano Controle CQ' }).click();

    const collapseButton = page
      .getByTestId('app-side-menu')
      .locator('.po-menu-collapse-button-icon');

    await collapseButton.click();

    await expect.poll(() => page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[data-testid="app-side-menu"] .po-menu');
      const toolbar = document.querySelector<HTMLElement>('po-toolbar .po-toolbar');
      const pageElement = document.querySelector<HTMLElement>('.po-page');

      if (!menu || !toolbar || !pageElement) {
        throw new Error('Shell contextual não encontrado.');
      }

      return {
        toolbarGap: Math.round(toolbar.getBoundingClientRect().left - menu.getBoundingClientRect().right),
        pageGap: Math.round(pageElement.getBoundingClientRect().left - menu.getBoundingClientRect().right),
      };
    })).toEqual({ toolbarGap: 0, pageGap: 0 });

    await collapseButton.click();

    await expect.poll(() => page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[data-testid="app-side-menu"] .po-menu');
      const toolbar = document.querySelector<HTMLElement>('po-toolbar .po-toolbar');

      if (!menu || !toolbar) {
        throw new Error('Menu ou toolbar contextual não encontrado.');
      }

      return Math.round(toolbar.getBoundingClientRect().left - menu.getBoundingClientRect().right);
    })).toBe(0);
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
      await expectSeparatedToolbarContent(page);

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

  test('posiciona as ações da sessão diretamente abaixo do botão acionado', async ({ page }) => {
    await login(page);

    const sessionActions = page.getByRole('button', { name: 'Abrir ações da sessão' });
    await sessionActions.click();
    const popup = page.locator('po-toolbar-actions .po-popup');
    await expect(popup).toBeVisible();

    const triggerBox = await sessionActions.boundingBox();
    const popupBox = await popup.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(popupBox).not.toBeNull();

    const triggerCenter = triggerBox!.x + triggerBox!.width / 2;
    const popupCenter = popupBox!.x + popupBox!.width / 2;
    expect(Math.abs(popupBox!.y - (triggerBox!.y + triggerBox!.height))).toBeLessThanOrEqual(2);
    expect(Math.abs(popupCenter - triggerCenter)).toBeLessThanOrEqual(2);
  });
});
