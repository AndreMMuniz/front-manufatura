import { expect, test } from '@playwright/test';

test('exibe as ações do Plano Controle CQ sem cortá-las no contêiner da página', async ({ page }) => {
  await page.setViewportSize({ width: 1587, height: 857 });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.goto('/quality-control');
  await expect(page).toHaveURL(/\/quality-control$/);
  await expect(page.locator('.quality-workspace__actions')).toBeVisible();

  const layout = await page.evaluate(() => {
    const pageContent = document.querySelector<HTMLElement>('.po-page-content');
    const actions = document.querySelector<HTMLElement>('.quality-workspace__actions');

    if (!pageContent || !actions) {
      throw new Error('Estrutura do workspace de qualidade não encontrada.');
    }

    const contentRect = pageContent.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    return {
      actionsBottom: actionsRect.bottom,
      contentBottom: contentRect.bottom,
      contentClientHeight: pageContent.clientHeight,
      contentScrollHeight: pageContent.scrollHeight,
    };
  });

  expect(layout.actionsBottom).toBeLessThanOrEqual(layout.contentBottom + 1);
  expect(layout.contentClientHeight).toBeGreaterThanOrEqual(layout.contentScrollHeight);
});

test('permite rolar até as ações após consultar uma ordem', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.goto('/quality-control');

  await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
  await page.getByRole('button', { name: 'Consultar Ordem' }).click();
  await expect(page.getByRole('option', { name: /30.*Soldar/ })).toBeVisible();

  const actions = page.locator('.quality-workspace__actions');
  const beforeScroll = await actions.boundingBox();
  expect(beforeScroll).not.toBeNull();
  expect(beforeScroll!.y + beforeScroll!.height).toBeGreaterThan(page.viewportSize()!.height);

  const pageContent = page.locator('.po-page-content');
  await pageContent.evaluate(element => element.scrollTo(0, element.scrollHeight));

  await expect.poll(() => pageContent.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(actions).toBeInViewport();
});
