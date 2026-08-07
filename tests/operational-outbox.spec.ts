import { expect, test } from '@playwright/test';
import { readOperationalOutbox } from './helpers/operational-outbox';

const ALL_OPERATIONAL_COMMAND_TYPES = [
  'GENERATE_INSPECTION_ROUTE',
  'SAVE_MEASUREMENT',
  'FINISH_EXAM',
  'STOP_INSPECTION_ROUTE',
  'SAVE_INSPECTION',
  'START_OPERATION',
  'REPORT_OPERATION',
  'END_OPERATION',
  'START_BATCH',
  'REPORT_BATCH',
  'END_BATCH',
  'CREATE_STOP',
  'FINISH_STOP',
] as const;

test('IndexedDB real captura CQ, operação, batelada e cadeia de parada na mesma Outbox', async ({
  page,
}) => {
  await page.goto('/_test/offline-persistence');
  await page.getByTestId('persist-operational-matrix').click();
  await expect(page.getByTestId('harness-result')).toContainText('"operationalMatrix":13');

  const matrix = await readOperationalOutbox(page);

  expect(matrix).toHaveLength(ALL_OPERATIONAL_COMMAND_TYPES.length);
  expect(matrix.map(item => item.commandType)).toEqual(ALL_OPERATIONAL_COMMAND_TYPES);
  expect(new Set(matrix.map(item => item.idempotencyKey)).size)
    .toBe(ALL_OPERATIONAL_COMMAND_TYPES.length);
  expect(matrix.find(item => item.commandType === 'FINISH_STOP')?.dependencyIds)
    .toEqual(['00000000-0000-4000-8000-000000000012']);
});
