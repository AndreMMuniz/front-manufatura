import { expect, test } from '@playwright/test';

const credentials = {
  user: 'operador',
  password: 'mock123',
};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill(credentials.user);
  await page.getByRole('textbox', { name: 'Senha' }).fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/quality-control$/);
}

test.describe('menu lateral principal', () => {
  test('não aparece na tela de login antes da autenticação', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByTestId('app-side-menu')).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Apontamento Manufatura' })).toBeVisible();
  });

  test('renderiza as opções principais uma abaixo da outra no desktop', async ({ page }) => {
    await login(page);

    const expectedItems = [
      'Plano Controle CQ',
      'Reporte Operações',
      'Reporte Batelada',
      'Paradas',
      'Refugo / Retrabalho',
      'Centro de Trabalho',
      'Operador',
      'Equipes',
      'Sair',
    ];

    for (const label of expectedItems) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
    }

    await expect(
      page.getByRole('menuitem', { name: 'Plano Controle CQ' }).locator('.an-flask'),
    ).toBeVisible();

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

    const menuBox = await page.getByRole('menuitem', { name: 'Plano Controle CQ' }).boundingBox();
    const contentBox = await page.getByRole('heading', { name: 'Plano de Controle' }).boundingBox();

    expect(menuBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(contentBox!.x).toBeGreaterThanOrEqual(menuBox!.x + menuBox!.width - 1);
  });

  test('navega pelo menu e mantém o item selecionado distinguível', async ({ page }) => {
    await login(page);

    await page.getByRole('menuitem', { name: 'Plano Controle CQ' }).click();

    await expect(page).toHaveURL(/\/quality-control$/);
    await expect(page.getByRole('menuitem', { name: 'Plano Controle CQ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plano de Controle' })).toBeVisible();
  });

  test('navega diretamente para Reporta Batelada pelo menu lateral', async ({ page }) => {
    await login(page);

    await page.getByRole('menuitem', { name: 'Reporte Batelada' }).click();

    await expect(page).toHaveURL(/\/batch-reporting$/);
    await expect(page.getByRole('heading', { name: 'Reporta Batelada' })).toBeVisible();
  });

  test('navega para o fluxo implementado de Refugo pelo menu lateral', async ({ page }) => {
    await login(page);

    await page.getByRole('menuitem', { name: 'Refugo / Retrabalho' }).click();

    await expect(page).toHaveURL(/\/scrap-rework$/);
    await expect(page.getByRole('heading', { name: 'Refugo / Retrabalho' })).toBeVisible();
    await expect(page.getByText('Ao iniciar a operação, o painel de Refugo será aberto.')).toBeVisible();
    await expect(page.getByText('Este módulo está pendente de implementação')).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Ordem' }).fill('450001');
    await page.getByRole('textbox', { name: 'OP' }).fill('OP-10458');
    await page.getByRole('button', { name: 'Consultar' }).click();
    await expect(page.getByText('OP carregada. Inicie a operação para liberar os apontamentos.')).toBeVisible();

    await page.getByRole('button', { name: 'Iniciar' }).click();
    await expect(page.getByText('Registrar Refugo')).toBeVisible();
    await expect(page.getByText('Nenhum refugo adicionado.')).toBeVisible();
  });

  test('mantém o menu acessível em viewport de tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await login(page);

    await expect(page.getByRole('menuitem', { name: 'Plano Controle CQ' })).toBeVisible();
  });
});
