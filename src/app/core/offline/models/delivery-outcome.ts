export const DELIVERY_OUTCOMES = [
  'NOT_DELIVERED', 'REJECTED', 'UNCERTAIN', 'CONFIRMED',
] as const;

export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

export function deliveryOutcomeOf(value: unknown): DeliveryOutcome | undefined {
  return DELIVERY_OUTCOMES.find(candidate => candidate === value);
}
