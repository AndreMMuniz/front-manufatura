import { expect, Page, test } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill(process.env['APP_LOGIN_USER'] ?? 'operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill(process.env['APP_LOGIN_PASSWORD'] ?? 'mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}

test.describe('título único das telas', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'celular', width: 390, height: 844 },
  ]) {
    test(`mantém um heading principal sem overflow em ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page);

      for (const screen of [
        { route: '/quality-control', title: 'Plano Controle CQ' },
        { route: '/work-center', title: 'Centro de Trabalho' },
        { route: '/item-consultation', title: 'Consulta Item' },
      ]) {
        await page.goto(screen.route);
        await expect(page.getByRole('heading', { name: screen.title, exact: true })).toHaveCount(1);
        await expect.poll(() => page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        )).toBe(true);
      }

      await page.goto('/quality-control');
      await expect(page.getByRole('heading', { name: 'Plano de Controle CQ', exact: true })).toHaveCount(0);
    });
  }
});
