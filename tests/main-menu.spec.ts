import { expect, test, type Page } from '@playwright/test';

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
  await page.getByRole('textbox', { name: 'Login' }).fill(process.env['APP_LOGIN_USER'] ?? 'operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill(process.env['APP_LOGIN_PASSWORD'] ?? 'mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
}

test.describe('Home de navegação', () => {
  test('é o landing do login e expõe os oito cartões e a Home global', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('heading', { name: 'Menu Principal' })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: 'Módulos disponíveis' });
    const cards = navigation.getByRole('link');
    await expect(cards).toHaveCount(8);
    await expect(cards).toHaveText(modules.map(module => module.label));
    expect(
      await cards.first().evaluate(element => getComputedStyle(element.closest('.po-page-content')!).opacity),
    ).toBe('1');
    await expect(navigation.getByText('Sair', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Menu Principal' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sair' })).toBeVisible();
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
    await expect(page).toHaveURL(/\/operation-reporting$/);
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
    expect(
      await page.getByRole('link', { name: 'Refugo / Retrabalho' }).locator('.main-menu__label').evaluate(element =>
        getComputedStyle(element).overflowWrap !== 'normal'),
    ).toBe(true);
    await expectNoHorizontalOverflow(page);
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
  });
});
