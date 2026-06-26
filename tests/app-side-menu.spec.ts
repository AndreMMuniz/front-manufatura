import { expect, test } from '@playwright/test';

const credentials = {
  user: 'operador',
  password: 'mock123',
};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(credentials.user);
  await page.getByLabel('Senha').fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
}

test.describe('menu lateral principal', () => {
  test('renderiza as opções principais uma abaixo da outra no desktop', async ({ page }) => {
    await login(page);

    const expectedItems = [
      'Menu Principal',
      'Plano Controle CQ',
      'Ordens e Reportes',
      'Paradas',
      'Refugo / Retrabalho',
      'Consulta Item',
      'Centro de Trabalho',
      'Operador',
      'Equipes',
      'Sair da sessão mock',
    ];

    for (const label of expectedItems) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
    }

    const boxes = await Promise.all(
      expectedItems.slice(0, 5).map(async label => {
        const box = await page.getByRole('menuitem', { name: label }).boundingBox();
        expect(box).not.toBeNull();
        return box!;
      }),
    );

    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index].y).toBeGreaterThan(boxes[index - 1].y);
    }

    const menuBox = await page.getByRole('menuitem', { name: 'Menu Principal' }).boundingBox();
    const contentBox = await page.getByRole('heading', { name: 'Menu Principal' }).boundingBox();

    expect(menuBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(contentBox!.x).toBeGreaterThanOrEqual(menuBox!.x + menuBox!.width - 1);
  });

  test('navega pelo menu e mantém o item selecionado distinguível', async ({ page }) => {
    await login(page);

    await page.getByRole('menuitem', { name: 'Plano Controle CQ' }).click();

    await expect(page).toHaveURL(/\/quality-control$/);
    await expect(page.getByRole('menuitem', { name: 'Plano Controle CQ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Plano Controle CQ/i })).toBeVisible();
  });

  test('mantém o menu acessível em viewport de tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await login(page);

    await expect(page.getByRole('menuitem', { name: 'Menu Principal' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Plano Controle CQ' })).toBeVisible();
  });
});
