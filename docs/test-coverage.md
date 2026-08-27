# Cobertura de testes — entrega de sincronização

| Camada | Evidência |
| --- | --- |
| Normalização | Outcomes válidos e fallback conservador para envelopes legados. |
| Persistência | Migração IndexedDB v4, reconciliação e bloqueio de retry em `CONFIRMATION_PENDING`. |
| Coordenador | Retry exclusivo para `NOT_DELIVERED`; rejeição, incerteza e confirmação. |
| BFF | Envelopes públicos sanitizados para qualidade, operação, batelada e paradas. |
| Central | Texto, ações, contadores, detalhe seguro e confirmação por consulta. |
| E2E | PUT CQ que retorna `502 invalid-upstream-response` fica incerto e não recebe segundo PUT; rejeição exibe motivo seguro; falha comprovada oferece retry; confirmação por consulta é identificada; ausência de verificador mantém a pendência. |

Os testes E2E usam identificadores e respostas sintéticos. Não adicionar
recibos, payloads ou dados operacionais de produção como fixtures.
