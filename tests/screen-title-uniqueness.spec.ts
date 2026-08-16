import { expect, Page, test } from '@playwright/test';
import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador-e2e');
  await page.getByRole('textbox', { name: 'Senha' }).fill('senha-e2e');
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
      await expect(page.getByRole('heading', { name: 'Plano Controle CQ', exact: true })).toHaveCount(0);
      await expect(page.locator('.po-toolbar-title')).toBeVisible();
      await expect(page.locator('.po-toolbar-title')).toHaveText('Plano Controle CQ');
      await expect(page.getByRole('heading', { name: 'Plano de Controle CQ', exact: true })).toHaveCount(0);
    });
  }
});
