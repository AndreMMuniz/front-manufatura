import { PersistedSyncError, RemoteCommandReceipt } from './outbox-entry';

export type ImmediateDeliveryResult =
  | { readonly status: 'SYNCED'; readonly receipt: RemoteCommandReceipt }
  | { readonly status: 'PENDING' }
  | { readonly status: 'ERROR'; readonly error: PersistedSyncError };
