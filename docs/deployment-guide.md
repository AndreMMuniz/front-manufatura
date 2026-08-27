# Operação e implantação — resultados de entrega

## Publicação coordenada

Publique BFF e frontend de forma coordenada. O frontend aceita temporariamente
envelopes antigos, mas classifica respostas ambíguas de modo conservador como
`UNCERTAIN`. Após a atualização, confirme que a base local migrou para a versão
4 sem reinicializar ou apagar a Outbox do operador.

Monitore quantidades por `deliveryOutcome`, o tempo em
`CONFIRMATION_PENDING` e a cobertura de verificadores por tipo de comando.
Logs devem usar somente campos permitidos: tipo de comando, estados, outcome,
tentativa, código sanitizado e correlação segura.

## Investigação de `CONFIRMATION_PENDING`

1. Abra os detalhes do registro e anote apenas o código e a correlação segura.
2. Consulte os registros operacionais do BFF e do Datasul pela correlação, sem
   copiar payload, valores medidos, laudos, tokens ou credenciais para tickets.
3. Se houver verificador somente leitura, execute **Verificar no Datasul** e
   siga o resultado `MATCH`, `MISSING`, `CONFLICT` ou `INCONCLUSIVE`.
4. Sem verificador contratado, mantenha a entrada preservada e escale para
   suporte/integração. Não use retry manual nem altere a entrada local para
   forçar novo PUT.

Uma confirmação por consulta é auditável e não chama o handler de envio. Um
novo comando só pode nascer por ação explícita e auditável no fluxo de origem.
