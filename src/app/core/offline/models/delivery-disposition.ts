export const DELIVERY_DISPOSITIONS = ['ACTIVE', 'ABANDONED', 'SUPERSEDED'] as const;

export type DeliveryDisposition = (typeof DELIVERY_DISPOSITIONS)[number];

export function deliveryDispositionOf(value: unknown): DeliveryDisposition {
  return value === 'ABANDONED' || value === 'SUPERSEDED' ? value : 'ACTIVE';
}
