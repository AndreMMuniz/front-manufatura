import { expect, test, type Page } from '@playwright/test';
import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

const modules = [
  { label: 'Plano Controle CQ', route: '/quality-control' },
  { label: 'Autoriza Roteiro CQ', route: '/quality-control/route-authorization' },
  { label: 'Reporte Ordem', route: '/operation-reporting' },
  { label: 'Reporte Batelada', route: '/batch-reporting' },
  { label: 'Paradas', route: '/stoppages' },
] as const;

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador-e2e');
  await page.getByRole('textbox', { name: 'Senha' }).fill('senha-e2e');
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

test.describe('Home de navegação', () => {
  test('mostra para mjocelio somente Plano Controle CQ e Reporte Ordem', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Login' }).fill('mjocelio');
    await page.getByRole('textbox', { name: 'Senha' }).fill('senha-e2e');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/menu$/);

    const cards = page
      .getByRole('navigation', { name: 'Módulos disponíveis' })
      .getByRole('link');
    await expect(cards).toHaveText(['Plano Controle CQ', 'Reporte Ordem']);
    await expect(page.getByRole('link', { name: 'Reporte Batelada' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Paradas' })).toHaveCount(0);
  });

  test('é o landing do login e expõe somente os cartões aprovados sem navegação lateral', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('heading', { name: 'Menu Principal' })).toHaveCount(0);
    const navigation = page.getByRole('navigation', { name: 'Módulos disponíveis' });
    const cards = navigation.getByRole('link');
    await expect(cards).toHaveCount(modules.length);
    await expect(cards).toHaveText(modules.map(module => module.label));
    expect(
      await cards.first().evaluate(element => getComputedStyle(element.closest('.po-page-content')!).opacity),
    ).toBe('1');
    await expect(navigation.getByText('Sair', { exact: true })).toHaveCount(0);
    await expect(page.locator('po-menu')).toHaveCount(0);
    await expect(page.locator('.po-toolbar-title')).toBeVisible();
    await expect(page.locator('.po-toolbar-title')).toHaveText('Menu Principal');
    await expect(page.getByTestId('session-identity'))
      .toHaveText('Apontamento Manufatura — operador-e2e');
    await expect(page.getByRole('button', { name: 'Abrir ações da sessão' })).toBeVisible();
  });

  test('preenche toda a largura visível sem reservar a coluna do menu lateral', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await login(page);

    const layout = await page.evaluate(() => {
      const toolbar = document.querySelector<HTMLElement>('.po-toolbar');
      const pageElement = document.querySelector<HTMLElement>('.po-page');
      const pageContent = document.querySelector<HTMLElement>('.po-page-content');
      const grid = document.querySelector<HTMLElement>('.main-menu__grid');
      const title = document.querySelector<HTMLElement>('.po-toolbar-title');
      const actions = document.querySelector<HTMLElement>('.po-toolbar-actions');

      if (!toolbar || !pageElement || !pageContent || !grid || !title || !actions) {
        throw new Error('Estrutura principal da página não encontrada.');
      }

      const toolbarRect = toolbar.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      const contentRect = pageContent.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();

      return {
        toolbarLeft: toolbarRect.left,
        toolbarRight: toolbarRect.right,
        pageRight: pageRect.right,
        contentRight: contentRect.right,
        gridCenter: gridRect.left + gridRect.width / 2,
        titleLeft: titleRect.left,
        actionsRight: actionsRect.right,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(layout.toolbarLeft).toBeCloseTo(0, 0);
    expect(layout.toolbarRight).toBeCloseTo(layout.viewportWidth, 0);
    expect(layout.pageRight).toBeCloseTo(layout.viewportWidth, 0);
    expect(layout.contentRight).toBeCloseTo(layout.viewportWidth, 0);
    expect(layout.gridCenter).toBeCloseTo(layout.viewportWidth / 2, 0);
    expect(layout.titleLeft).toBeLessThan(layout.viewportWidth / 2);
    expect(layout.actionsRight).toBeGreaterThan(layout.viewportWidth / 2);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });

  test('cada cartão navega para seu destino', async ({ page }) => {
    await login(page);

    for (const module of modules) {
      await page.getByRole('link', { name: module.label }).click();
      await expect(page).toHaveURL(new RegExp(`${module.route.replace('/', '\\/')}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/menu$/);
    }
  });

  test('segue a ordem visual por Tab, mostra foco e aceita Enter e Espaço', async ({ page }) => {
    await login(page);

    const first = page.getByRole('link', { name: modules[0].label });
    await first.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(first).toBeFocused();
    expect(
      await first.evaluate(element => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
      }),
    ).toBe(true);

    for (const module of modules.slice(1)) {
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: module.label })).toBeFocused();
    }

    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/quality-control$/);
    await page.goBack();
    await page.getByRole('link', { name: modules[1].label }).focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/\/quality-control\/route-authorization$/);
  });

  test('mantém duas colunas e cartões quadrados em 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const cards = page.getByRole('navigation', { name: 'Módulos disponíveis' }).getByRole('link');
    const boxes = await cards.evaluateAll(elements =>
      elements.map(element => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );

    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(2);
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
    expect(Math.abs(boxes[0].x - boxes[2].x)).toBeLessThanOrEqual(2);
    for (const box of boxes) {
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2);
      expect(box.width).toBeGreaterThanOrEqual(48);
    }
    await expectNoHorizontalOverflow(page);
    await expectSeparatedToolbarContent(page);
  });

  test('mantém pelo menos três colunas e cartões quadrados em 1024x768', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page);

    const cards = page.getByRole('navigation', { name: 'Módulos disponíveis' }).getByRole('link');
    const boxes = await cards.evaluateAll(elements =>
      elements.map(element => {
        const box = element.getBoundingClientRect();
        return { y: box.y, width: box.width, height: box.height };
      }),
    );

    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(2);
    expect(Math.abs(boxes[0].y - boxes[2].y)).toBeLessThanOrEqual(2);
    for (const box of boxes) {
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2);
    }
    await expectNoHorizontalOverflow(page);
    await expectSeparatedToolbarContent(page);
  });
});
