import type { BrowserContext } from '@playwright/test';

export async function mockAuthentication(context: BrowserContext): Promise<void> {
  await context.route('**/api/auth/login', async route => {
    const body = route.request().postDataJSON() as { login?: unknown };
    const login = typeof body.login === 'string' ? body.login.trim() : 'operador';
    const tokenExpiresAt = new Date(Date.now() + 28_800_000).toISOString();
    await route.fulfill({
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      json: {
        token: 'e2e-memory-token',
        tokenExpiresAt,
        offlineSessionExpiresAt: tokenExpiresAt,
        usuario: {
          id: `E2E-${login}`,
          nome: 'Operador E2E',
          login,
          permissoes: [
            'MENU_PRINCIPAL',
            'PLANO_CONTROLE_CQ',
            'AUTORIZACAO_ROTEIRO_DIVERGENCIA',
            'REPORTE_ORDEM',
            'REPORTE_BATELADA',
            'REPORTE_PARADAS',
          ],
        },
      },
    });
  });
}
