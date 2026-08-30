# Classificação do resultado de entrega da sincronização

## Contexto

A Outbox atual representa bem o ciclo local dos comandos, mas usa a categoria
de erro principalmente para decidir entre nova tentativa e intervenção. Essa
classificação não registra com precisão o que ocorreu com a entrega remota.
Consequentemente, respostas `5xx` diferentes podem ser tratadas da mesma forma,
mesmo quando uma requisição não chegou ao destino, foi rejeitada explicitamente
ou pode ter sido processada sem que o recibo fosse validado.

O incidente de `ResultExames` tornou essa ambiguidade visível. O Datasul gravou
o resultado e devolveu HTTP 200 com `dentroFaixa: null`, mas a validação do BFF
considerou o recibo inválido e respondeu `502 invalid-upstream-response` ao
navegador. A Outbox interpretou o `502` como falha transitória e manteve o
registro pendente para reenvio, embora o efeito remoto já pudesse existir.

Esta mudança vale para todos os comandos enviados pela Outbox, não somente para
o Plano Controle CQ.

## Objetivos

- separar o ciclo local da fila do resultado conhecido da entrega;
- distinguir falta comprovada de entrega, rejeição, resultado incerto e
  confirmação;
- repetir automaticamente somente quando for seguro afirmar que o comando não
  foi entregue;
- impedir duplicidades quando o resultado remoto for incerto;
- apresentar no painel um motivo claro, seguro e acionável;
- permitir confirmação posterior por consulta sem reenviar o comando;
- migrar registros existentes sem perder payload, identidade ou histórico.

## Não objetivos

- criar imediatamente consultas de confirmação para todos os contratos
  Datasul;
- inferir sucesso apenas pela comparação local de valores;
- expor corpos de requisição, respostas completas, credenciais ou detalhes
  internos no painel e nos logs;
- substituir os estados atuais da Outbox por uma única enumeração combinada.

## Modelo de estado

O estado da Outbox continuará descrevendo o ciclo local. Será acrescentado
`CONFIRMATION_PENDING` aos estados existentes:

- `PENDING`: comando preservado e ainda aguardando envio;
- `SYNCING`: tentativa em andamento;
- `RETRY_WAIT`: nova tentativa segura agendada;
- `CONFIRMATION_PENDING`: envio possivelmente processado; reenvio bloqueado;
- `SYNCED`: efeito remoto confirmado;
- `BLOCKED_AUTH`, `BLOCKED_DEPENDENCY` e `ERROR`: mantêm suas responsabilidades
  atuais.

Um campo ortogonal e persistido, `deliveryOutcome`, descreverá o conhecimento
sobre a entrega:

- `NOT_DELIVERED`: há evidência de que o comando não chegou ao destino;
- `REJECTED`: o gateway ou o destino respondeu explicitamente que não aceitou
  o comando;
- `UNCERTAIN`: o envio foi iniciado, mas não é possível afirmar se o efeito
  remoto ocorreu;
- `CONFIRMED`: um recibo válido ou uma consulta posterior confirmou o efeito.

`deliveryOutcome` será ausente enquanto um comando novo nunca tiver sido
tentado. O histórico de tentativas e o último erro continuarão separados do
payload imutável.

## Contrato de erro

Erros de comandos deverão usar um envelope estruturado e sanitizado:

```json
{
  "code": "RESULT_RECEIPT_INVALID",
  "category": "TRANSIENT",
  "deliveryOutcome": "UNCERTAIN",
  "userMessage": "O destino respondeu, mas a gravação ainda precisa ser confirmada.",
  "correlationId": "corr-123"
}
```

`code` será estável e próprio para automação. `userMessage` será limitado,
sanitizado e não poderá conter segredo ou payload operacional. `correlationId`
continuará opcional. A ausência de `deliveryOutcome` em contratos antigos será
normalizada conservadoramente pelo cliente.

O BFF deverá classificar o erro no ponto em que conhece a etapa alcançada:

- validação local antes da chamada remota: `REJECTED`;
- destino respondeu com recusa funcional ou HTTP 4xx: `REJECTED`;
- chamada remota não foi iniciada ou conexão foi recusada antes da entrega:
  `NOT_DELIVERED`;
- timeout após o início, conexão interrompida ou resposta remota impossível de
  validar: `UNCERTAIN`;
- recibo remoto válido: `CONFIRMED`.

Um HTTP 5xx isolado não será suficiente para decidir a entrega. O envelope do
BFF será a fonte preferencial. Quando não houver informação suficiente, a
normalização escolherá `UNCERTAIN`, pois reenviar um comando possivelmente
processado é menos seguro que aguardar confirmação.

## Transições e política de repetição

| Resultado da tentativa | Estado local | Reenvio automático | Ação seguinte |
| --- | --- | --- | --- |
| `NOT_DELIVERED` | `RETRY_WAIT` | Sim | Aplicar backoff e tentar novamente |
| `REJECTED` | `ERROR` | Não | Corrigir, descartar ou intervir |
| `UNCERTAIN` | `CONFIRMATION_PENDING` | Não | Consultar o destino |
| `CONFIRMED` | `SYNCED` | Não aplicável | Preservar recibo |

Autenticação expirada continuará usando `BLOCKED_AUTH`. Dependências locais
continuarão usando `BLOCKED_DEPENDENCY`. Essas condições não devem mascarar o
resultado de entrega já conhecido.

No armazenamento local, `VALIDATION` e `CONFLICT` recebem também a disposição
terminal `REJECTED`. Essa disposição retira o comando dos contadores ativos e
do retry manual, mas preserva identidade, payload sanitizado, mensagem e
tentativa como histórico auditável. Registros legados equivalentes são
normalizados na migração da base sem alterar falhas `TRANSIENT`.

O retry manual também ficará indisponível em `CONFIRMATION_PENDING`. Caso não
exista verificador para o comando, o painel informará que a confirmação exige
intervenção. Um novo envio somente poderá nascer como outro comando por uma
ação explícita e auditável, nunca pela reutilização silenciosa da tentativa
incerta.

## Confirmação por consulta

O sincronizador terá um registro de verificadores por `commandType`, separado
dos handlers de envio. Um verificador recebe a identidade imutável do comando e
consulta o sistema remoto sem produzir novo efeito.

O resultado da consulta será um destes:

- `MATCH`: registro remoto encontrado com a mesma identidade e conteúdo;
  reconcilia como `CONFIRMED` e `SYNCED`;
- `MISSING`: registro comprovadamente ausente; volta para `PENDING` com
  `NOT_DELIVERED`, permitindo uma nova tentativa segura;
- `CONFLICT`: identidade encontrada com conteúdo diferente; mantém o comando
  bloqueado para intervenção e não sobrescreve o remoto;
- `INCONCLUSIVE`: consulta indisponível ou resposta insuficiente; permanece em
  `CONFIRMATION_PENDING`.

A comparação usará a representação canônica e os campos de identidade definidos
por cada comando. Ela não dependerá de textos apresentados na interface. Quando
um endpoint de consulta não existir, o registro permanecerá preservado e o
painel explicará essa limitação.

## Migração

A versão do armazenamento local será incrementada. A migração não alterará
payload, hash, chave de idempotência, proprietário, datas nem recibos.

- registros `SYNCED` serão marcados como `CONFIRMED`;
- erros `VALIDATION` e `CONFLICT` serão marcados como `REJECTED`;
- falhas anteriores cuja entrega não possa ser comprovada serão marcadas como
  `UNCERTAIN` e movidas para `CONFIRMATION_PENDING`;
- comandos `PENDING` sem tentativa anterior continuarão sem
  `deliveryOutcome`;
- registros cuja ausência remota já seja comprovável poderão usar
  `NOT_DELIVERED` e manter a política de retry.

A migração será idempotente e testará reabertura do banco. Nenhum registro
antigo incerto será reenviado automaticamente apenas por iniciar uma versão
nova da aplicação.

## Painel de sincronização

O painel priorizará `deliveryOutcome` e o motivo persistido, mantendo o estado
da fila como informação complementar:

- `NOT_DELIVERED`: **Não enviado — falha de comunicação. Nova tentativa
  agendada.**
- `REJECTED`: **Rejeitado —** seguido do motivo seguro devolvido pelo BFF ou
  Datasul;
- `UNCERTAIN`: **Entrega não confirmada — reenvio pausado para evitar
  duplicidade.**
- `CONFIRMED`: **Integrado com o Datasul.**

Quando a confirmação vier de consulta, o detalhe indicará **Confirmado por
consulta ao Datasul**. Um conflito mostrará que já existe conteúdo diferente no
destino. Código técnico e correlação ficarão disponíveis no detalhe para suporte,
sem substituir a mensagem principal.

No caso de resultados de qualidade, um recibo com identidade e totais válidos
e `dentroFaixa: null` é `CONFIRMED`; `null` significa classificação funcional
não informada. Um recibo realmente inválido após o PUT será `UNCERTAIN`, não
`NOT_DELIVERED` nem `REJECTED`.

## Observabilidade

As transições registrarão `commandType`, estado anterior e posterior,
`deliveryOutcome`, código sanitizado, tentativa e correlação. Logs não conterão
o payload, valor medido, laudo, token ou credencial.

Serão distinguídos eventos de envio não realizado, rejeição, entrega incerta,
confirmação direta, confirmação por consulta e conflito. Falha no mecanismo de
logging não alterará o resultado da sincronização.

## Testes

### Normalização e contrato

- preserva `deliveryOutcome` explícito e válido retornado pelo BFF;
- rejeita ou normaliza valores desconhecidos sem confiar em texto livre;
- classifica ausência comprovada de entrega como `NOT_DELIVERED`;
- classifica 4xx explícito como `REJECTED`;
- classifica timeout, interrupção após início e recibo inválido como
  `UNCERTAIN`;
- sanitiza código, mensagem e correlação.

### Outbox e coordenador

- agenda retry somente para `NOT_DELIVERED`;
- move rejeição para `ERROR` sem retry automático;
- move incerteza para `CONFIRMATION_PENDING` e não faz novo PUT;
- reconcilia recibo válido como `CONFIRMED` e `SYNCED`;
- impede retry automático e manual de confirmação pendente;
- mantém regras de lease, proprietário e corrida de sessão;
- preserva payload, hash e chave de idempotência em todas as transições.

### Verificadores

- `MATCH` confirma sem reenviar;
- `MISSING` libera uma tentativa segura;
- `CONFLICT` não sobrescreve o destino;
- `INCONCLUSIVE` mantém o estado;
- ausência de verificador não gera PUT.

### Migração e interface

- migra registros antigos de forma idempotente e sobrevive à reabertura;
- apresenta textos e ações corretos para os quatro resultados;
- exibe motivo seguro e correlação em rejeições;
- não oferece retry em confirmação pendente;
- diferencia confirmação direta de confirmação por consulta;
- mantém indicadores agregados coerentes com o novo estado.

### Integração

- executa a matriz de classificação em todos os handlers registrados;
- comprova que um recibo inválido após envio não dispara segundo comando;
- comprova que uma rejeição funcional preserva a razão devolvida;
- comprova que a confirmação por consulta encerra a pendência sem PUT;
- mantém compatibilidade com envelopes de erro antigos pelo fallback
  conservador.

## Implantação

O BFF e o frontend devem ser publicados de forma coordenada. O frontend aceita
temporariamente erros antigos, classificando casos ambíguos como `UNCERTAIN`.
Após a migração, métricas devem acompanhar a quantidade por
`deliveryOutcome`, o tempo em `CONFIRMATION_PENDING` e a disponibilidade de
verificadores por comando.

A primeira versão pode entrar sem verificadores para todos os comandos, desde
que preserve a incerteza e não reenvie. Novos verificadores serão adicionados
por contrato remoto, sem alterar novamente a máquina de estados principal.
