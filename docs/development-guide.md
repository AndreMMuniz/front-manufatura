# Guia de desenvolvimento — sincronização

## Política de entrega

Somente `NOT_DELIVERED` pode criar uma nova tentativa da mesma entrada. Uma
rejeição explícita fica em `ERROR` com motivo sanitizado. Um timeout, resposta
incompleta ou `5xx` sem evidência confiável de não entrega deve ser classificado
como `UNCERTAIN` e parar em `CONFIRMATION_PENDING`.

Não reduza um `5xx` a `NOT_DELIVERED` por status HTTP isolado. Por exemplo, um
`502 invalid-upstream-response` depois de um PUT pode significar que o destino
gravou e o recibo não pôde ser validado. Reenviar nesse ponto pode duplicar o
efeito remoto.

## Confirmação por consulta

Verificadores pertencem a `CommandConfirmationRouter`, separados dos handlers
de envio. Eles recebem a identidade imutável do comando e executam apenas
consulta remota:

- `MATCH` confirma sem PUT;
- `MISSING` libera um novo envio seguro;
- `CONFLICT` preserva a pendência para intervenção;
- `INCONCLUSIVE` mantém `CONFIRMATION_PENDING`.

Se um `commandType` ainda não tiver verificador, a Central deve informar essa
limitação e manter o registro em `CONFIRMATION_PENDING`; nunca deve recorrer ao
handler de envio. A primeira entrega não adiciona verificadores onde o Datasul
não oferece uma consulta GET contratada.

## Como testar

Ao incluir um comando ou verificador, cubra a classificação explícita do BFF,
a transição da Outbox e a ação apresentada na Central. No Playwright, semeie
somente valores sintéticos e conte a requisição de escrita: uma entrada incerta
deve continuar com exatamente um PUT mesmo depois de atualizar a tela.
