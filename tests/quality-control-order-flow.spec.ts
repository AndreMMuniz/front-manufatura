import { expect, test } from '@playwright/test';
import { readOperationalOutbox } from './helpers/operational-outbox';
import { mockAuthentication } from './helpers/auth';

test.beforeEach(async ({ context }) => mockAuthentication(context));

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Login' }).fill('operador');
  await page.getByRole('textbox', { name: 'Senha' }).fill('mock123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await page.getByRole('link', { name: 'Plano Controle CQ' }).click();
  await expect(page).toHaveURL(/\/quality-control$/);
}

test.describe('workspace unificado do Plano Controle CQ', () => {
  test('mantém contexto, inspeção e digitação na mesma URL e salva uma medição', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('textbox', { name: 'Ordem' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'OP' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Split' })).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
    await page.getByRole('button', { name: 'Consultar Ordem' }).click();

    const operation = page.getByRole('option', { name: /10.*Cortar chapa/ });
    await expect(operation).toBeVisible();
    await expect(page.getByRole('option', { name: /20.*Dobrar chapa/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /30.*Soldar/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toHaveCount(0);

    await operation.click();

    await expect(operation).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('10 - Cortar chapa', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Operador' }).fill('001');
    await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeEnabled();

    await page.getByRole('button', { name: 'Gerar Roteiro' }).click();

    await expect(page).toHaveURL(/\/quality-control$/);
    await expect(
      page.getByRole('heading', { name: 'Execução do roteiro de inspeção' }),
    ).toBeVisible();
    await expect(page.getByText('500517')).toBeVisible();
    await expect(page.getByText('Frequência: 00:02 h')).toBeVisible();
    await expect(page.getByText('Amostra: 1')).toBeVisible();
    await expect(page.getByText('325571', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Digitar medição' }).click();
    await expect(page.getByRole('heading', { name: 'Registro das medições' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Execução do roteiro de inspeção' })).toBeVisible();
    await expect(page).toHaveURL(/\/quality-control$/);

    const result = page.getByRole('textbox', { name: 'Resultado' });
    await result.fill('484');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Salvo neste dispositivo — envio pendente.')).toBeVisible();
    await expect(page.getByText('1 de 3 concluídos')).toBeVisible();
    await expect(page.getByText('Característica 2 / 3')).toBeVisible();

    await result.fill('255');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Salvo neste dispositivo — envio pendente.')).toBeVisible();
    await expect(page.getByText('2 de 3 concluídos')).toBeVisible();
    await expect(page).toHaveURL(/\/quality-control$/);

    const outbox = await readOperationalOutbox(page);
    const measurements = outbox.filter(entry => entry.commandType === 'SAVE_QUALITY_RESULT');
    expect(measurements).toHaveLength(2);
    expect(new Set(measurements.map(entry => entry.idempotencyKey)).size).toBe(2);
  });

  test('responde aos controles e registra os quatro tipos de resultado até a finalização', async ({ page }) => {
    await login(page);

    await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
    await page.getByRole('button', { name: 'Consultar Ordem' }).click();
    await page.getByRole('option', { name: /30.*Soldar/ }).click();
    await page.getByRole('textbox', { name: 'Operador' }).fill('001');
    await page.getByRole('button', { name: 'Gerar Roteiro' }).click();
    await page.getByRole('button', { name: 'Digitar medição' }).click();

    const panel = page.locator('app-exam-entry-panel');
    const previous = panel.getByRole('button', { name: 'Anterior' });
    const next = panel.getByRole('button', { name: 'Próxima' });
    const save = panel.getByRole('button', { name: 'Salvar', exact: true });

    await expect(panel.getByText('Característica 1 / 4')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Resultado', exact: true })).toBeVisible();
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect(panel.getByText('Característica 2 / 4')).toBeVisible();
    await expect(panel.getByRole('combobox', { name: 'Resultado' })).toBeVisible();
    await previous.click();
    await expect(panel.getByText('Característica 1 / 4')).toBeVisible();

    await panel.getByRole('textbox', { name: 'Resultado', exact: true }).fill('488,25');
    await save.click();

    await expect(panel.getByText('Característica 2 / 4')).toBeVisible();
    await panel.getByRole('combobox', { name: 'Resultado' }).selectOption({ label: 'Conforme' });
    await save.click();

    await expect(panel.getByText('Característica 3 / 4')).toBeVisible();
    await panel.getByRole('textbox', { name: 'Laudo' }).fill('Aprovado visualmente');
    await save.click();

    await expect(panel.getByText('Característica 4 / 4')).toBeVisible();
    await panel.getByRole('textbox', { name: 'Resultado mínimo' }).fill('23,90');
    await panel.getByRole('textbox', { name: 'Resultado máximo' }).fill('24,10');
    await save.click();

    await expect(panel.getByText('4 de 4 salvas')).toBeVisible();
    const finalize = panel.getByRole('button', { name: 'Finalizar ficha' });
    await expect(finalize).toBeEnabled();

    const outbox = await readOperationalOutbox(page);
    const measurements = outbox.filter(entry => entry.commandType === 'SAVE_QUALITY_RESULT');
    const payloadByComponent = Object.fromEntries(
      measurements.map(entry => [entry.payload['codComponente'], entry.payload]),
    );
    expect(measurements).toHaveLength(4);
    expect(payloadByComponent[10]).toEqual(expect.objectContaining({ resultado: 488.25 }));
    expect(payloadByComponent[20]).toEqual(expect.objectContaining({ nrTabela: 8, seqOpcao: 1 }));
    expect(payloadByComponent[30]).toEqual(expect.objectContaining({ laudo: 'Aprovado visualmente' }));
    expect(payloadByComponent[40]).toEqual(expect.objectContaining({ resultado: 23.9, resultadoMax: 24.1 }));

    await finalize.click();
    await expect(finalize).toBeDisabled();
    const finalizedOutbox = await readOperationalOutbox(page);
    const finalization = finalizedOutbox.find(entry => entry.commandType === 'FINALIZE_QUALITY_ROUTE');
    expect(finalization).toBeDefined();
    expect(new Set(finalization?.dependencyIds)).toEqual(
      new Set(measurements.map(entry => entry.idempotencyKey)),
    );

    await panel.getByRole('button', { name: 'Fechar' }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Digitar medição' })).toBeFocused();
  });

  for (const viewport of [
    { name: 'móvel', width: 390, height: 844 },
    { name: 'tablet', width: 1024, height: 768 },
  ]) {
    test(`não cria overflow horizontal em viewport ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page);

      await page.getByRole('textbox', { name: 'Ordem' }).fill('325571');
      await page.getByRole('button', { name: 'Consultar Ordem' }).click();
      await page.getByRole('option', { name: /30.*Soldar/ }).click();
      await page.getByRole('textbox', { name: 'Operador' }).fill('001');

      await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Gerar Roteiro' })).toBeEnabled();
      await page.getByRole('button', { name: 'Gerar Roteiro' }).click();
      await page.getByRole('button', { name: 'Digitar medição' }).click();

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});
