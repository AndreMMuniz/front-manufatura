import { expect, test } from '@playwright/test';

async function openInspection(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Plano Controle CQ' }).click();
  await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
  await page.getByRole('button', { name: 'Consultar Ordem' }).click();
  await page.getByRole('option', { name: /10.*Cortar chapa/ }).click();
  await page.getByRole('button', { name: 'Gerar Roteiro' }).click();
}

for (const viewport of [
  { name: 'celular', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 768 },
]) {
  test(`mantém o resultado medido legível e acionável em ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openInspection(page);

    await page.getByRole('button', { name: 'Digitar medição' }).click();
    await page.getByRole('textbox', { name: 'Min' }).fill('485,5');
    await page.getByRole('textbox', { name: 'Max' }).fill('490,75');
    await page.getByRole('button', { name: 'Salvar' }).click();

    const approvedComponent = page.locator('.inspection-process__component').first();
    await expect(approvedComponent).toContainText('Aprovado');
    await expect(approvedComponent).toContainText('Mín: 485,5');
    await expect(approvedComponent).toContainText('Máx: 490,75');
    await expect(approvedComponent).toContainText(/Apontado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);

    const layout = await approvedComponent.evaluate(element => {
      const componentRect = element.getBoundingClientRect();
      const statusItems = Array.from(
        element.querySelectorAll<HTMLElement>('.inspection-process__component-status > span'),
      ).map(item => item.getBoundingClientRect());
      const overlaps = statusItems.some((current, index) => statusItems.slice(index + 1).some(next => (
        Math.min(current.right, next.right) > Math.max(current.left, next.left)
        && Math.min(current.bottom, next.bottom) > Math.max(current.top, next.top)
      )));

      return {
        componentOverflow: element.scrollWidth > element.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        outsideComponent: statusItems.some(item => item.left < componentRect.left || item.right > componentRect.right),
        overlaps,
      };
    });

    expect(layout).toEqual({
      componentOverflow: false,
      pageOverflow: false,
      outsideComponent: false,
      overlaps: false,
    });

    await approvedComponent.click();
    await expect(approvedComponent).toHaveAttribute('aria-current', 'step');
  });
}
