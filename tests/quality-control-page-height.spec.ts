import { expect, test } from '@playwright/test';

test('exibe as ações do Plano Controle CQ sem cortá-las no contêiner da página', async ({ page }) => {
  await page.setViewportSize({ width: 1587, height: 857 });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.goto('/quality-control');

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
