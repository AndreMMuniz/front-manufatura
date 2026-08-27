# Modelos de dados locais

## Resultado de entrega da sincronização

O ciclo da fila e o conhecimento sobre a entrega são eixos distintos. `status`
descreve o trabalho local; `deliveryOutcome` registra o que pode ser afirmado
sobre o destino. O payload, o hash, a chave de idempotência, o proprietário e
as datas de origem não são alterados por reconciliação.

| `SyncStatus` | `DeliveryOutcome` | Significado operacional |
| --- | --- | --- |
| `PENDING` | ausente | Comando novo, ainda não enviado. |
| `RETRY_WAIT` | `NOT_DELIVERED` | A ausência de entrega foi comprovada; retry com backoff é permitido. |
| `ERROR` | `REJECTED` | O destino ou gateway recusou explicitamente; preservar o motivo seguro. |
| `CONFIRMATION_PENDING` | `UNCERTAIN` | O envio pode ter sido processado; reenvio automático e manual ficam bloqueados. |
| `SYNCED` | `CONFIRMED` | Recibo válido ou consulta somente leitura confirmou o efeito remoto. |

Condições locais, como autenticação e dependências, continuam usando os seus
estados próprios e não apagam um resultado de entrega já conhecido.

## Migração v4

A base IndexedDB usa a versão 4. A migração é idempotente e conserva os campos
imutáveis dos registros existentes:

- `SYNCED` passa a `CONFIRMED`;
- erros históricos de validação ou conflito passam a `REJECTED`;
- falhas históricas ambíguas passam a `UNCERTAIN` e `CONFIRMATION_PENDING`;
- comandos sem tentativa anterior permanecem sem `deliveryOutcome`.

Nenhum registro histórico ambíguo pode voltar a ser enviado somente porque a
aplicação foi atualizada.

## Envelope público de erro

Os BFFs expõem apenas o contrato sanitizado abaixo. Não use mensagem de erro,
stack, URL, corpo remoto ou causa de rede como resposta pública.

```json
{
  "code": "INVALID_UPSTREAM_RESPONSE",
  "category": "TRANSIENT",
  "deliveryOutcome": "UNCERTAIN",
  "userMessage": "O destino respondeu, mas a gravação ainda precisa ser confirmada.",
  "correlationId": "correlacao-segura-opcional"
}
```

`code`, `category`, `deliveryOutcome` e `userMessage` são obrigatórios para os
novos contratos; `correlationId` é opcional. Clientes que recebem envelopes
legados tratam casos ambíguos como `UNCERTAIN`.
