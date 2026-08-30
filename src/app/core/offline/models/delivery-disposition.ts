export const DELIVERY_DISPOSITIONS = [
  'ACTIVE',
  'ABANDONED',
  'SUPERSEDED',
  'REJECTED',
] as const;

export type DeliveryDisposition = (typeof DELIVERY_DISPOSITIONS)[number];

export function deliveryDispositionOf(value: unknown): DeliveryDisposition {
  return value === 'ABANDONED' || value === 'SUPERSEDED' || value === 'REJECTED'
    ? value
    : 'ACTIVE';
}
