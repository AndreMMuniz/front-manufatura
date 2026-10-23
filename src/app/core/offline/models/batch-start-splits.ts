import type { RemoteCommandReceipt } from './outbox-entry';

export function batchStartSplits(receipt: RemoteCommandReceipt | undefined): ReadonlyMap<string, string> {
  return new Map(receipt?.orderResults?.flatMap(result =>
    result.success && typeof result.split === 'string'
      && /^[1-9]\d*$/.test(result.split) && Number.isSafeInteger(Number(result.split))
      ? [[result.orderId, result.split] as const] : []));
}
