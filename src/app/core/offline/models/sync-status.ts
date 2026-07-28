export const SYNC_STATUSES = [
  'PENDING',
  'SYNCING',
  'RETRY_WAIT',
  'SYNCED',
  'BLOCKED_AUTH',
  'BLOCKED_DEPENDENCY',
  'ERROR',
] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];
