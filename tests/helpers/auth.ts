import type { BrowserContext } from '@playwright/test';

import { mockE2eBackend } from './e2e-backend';

export async function mockAuthentication(context: BrowserContext): Promise<void> {
  await mockE2eBackend(context);
}
