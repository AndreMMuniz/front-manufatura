import type { RemoteCommandReceipt } from './outbox-entry';

export function operationStartSplit(
  receipt: RemoteCommandReceipt | undefined,
  ordem: string,
  op: string,
): string | undefined {
  const result = receipt?.businessResult;
  const split = result && typeof result === 'object' && !Array.isArray(result)
    ? result['split'] : undefined;
  if (typeof split === 'string' && /^[1-9]\d*$/.test(split) && Number.isSafeInteger(Number(split))) return split;
  // Older receipts already contain the confirmed split in their server identity.
  const parts = receipt?.serverRecordId?.split(':');
  if (parts?.length === 5 && parts[0] === 'datasul' && parts[1] === 'operation'
    && parts[2] === ordem && parts[3] === op
    && /^[1-9]\d*$/.test(parts[4]) && Number.isSafeInteger(Number(parts[4]))) return parts[4];
  return undefined;
}
