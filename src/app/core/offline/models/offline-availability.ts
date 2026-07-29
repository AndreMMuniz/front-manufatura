export type OfflineAvailabilityKind = 'login' | 'query';

export const OFFLINE_LOGIN_REQUIRED_MESSAGE =
  'A autenticação exige conexão com o Datasul.';

export const OFFLINE_DATA_UNAVAILABLE_MESSAGE =
  'Dados não disponíveis neste dispositivo. Conecte-se para consultar o Datasul.';

export class OfflineAvailabilityError extends Error {
  constructor(readonly kind: OfflineAvailabilityKind) {
    super(messageForOfflineAvailability(kind));
  }
}

export function messageForOfflineAvailability(kind: OfflineAvailabilityKind): string {
  return kind === 'login'
    ? OFFLINE_LOGIN_REQUIRED_MESSAGE
    : OFFLINE_DATA_UNAVAILABLE_MESSAGE;
}
