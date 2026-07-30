export const SYNC_UNSYNCHRONIZED_ABANDON = 'SYNC_UNSYNCHRONIZED_ABANDON';

export type AbandonCommandResult =
  | 'abandoned'
  | 'denied'
  | 'stale-or-ineligible'
  | 'has-dependents'
  | 'has-later-commands'
  | 'storage-error';

export interface AbandonCommandRequest {
  readonly ownerId: string;
  readonly actorId: string;
  readonly localId: string;
  readonly permission: string;
  readonly authorized: boolean;
  readonly reason: string;
  readonly now: string;
  readonly sessionIsCurrent: () => boolean;
}
