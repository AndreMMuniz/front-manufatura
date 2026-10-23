// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { operationStartSplit } from './operation-start-split';
import type { RemoteCommandReceipt } from './outbox-entry';

describe('operationStartSplit', () => {
  const receipt: RemoteCommandReceipt = {
    serverRecordId: 'datasul:operation:372562:10:2',
    receivedAt: '2026-10-23T12:00:00.000Z', processedAt: '2026-10-23T12:00:00.000Z', duplicate: false,
  };
  it('reads explicit split and legacy receipts', () => {
    expect(operationStartSplit({ ...receipt, businessResult: { split: '3' } }, '372562', '10')).toBe('3');
    expect(operationStartSplit(receipt, '372562', '10')).toBe('2');
  });
  it('does not reuse another order or operation from a legacy receipt', () => {
    expect(operationStartSplit(receipt, '372563', '10')).toBeUndefined();
    expect(operationStartSplit(receipt, '372562', '20')).toBeUndefined();
    expect(operationStartSplit(undefined, '372562', '10')).toBeUndefined();
  });
  it.each(['0', '-1', '1.5', '', '9007199254740992'])('rejects invalid split %j', split => {
    expect(operationStartSplit({ ...receipt, serverRecordId: 'unknown', businessResult: { split } }, '372562', '10')).toBeUndefined();
  });
});
