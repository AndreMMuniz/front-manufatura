# Autorização de roteiros CQ

Contratos observados para o módulo **Autorização de Roteiros CQ**. A tela deverá localizar roteiros com pendências que não puderam ser finalizados, permitir a análise e alteração dos dados aplicáveis e, após decisão do usuário autorizado, finalizar o roteiro com autorização.

## Contrato implementado no BFF

O frontend não acessa o Datasul diretamente. O fluxo usa os endpoints abaixo, todos
sob `/api/quality-control/route-authorizations` e protegidos pela permissão
`AUTORIZACAO_ROTEIRO_DIVERGENCIA`, associada ao programa Datasul `fcq-0002`.
O token Bearer da sessão identifica o usuário no servidor; `codUsuario` não é
aceito do navegador e `companyId` vem da configuração do BFF.

No carregamento da análise, o BFF consulta novamente `autorizacaoroteiros` com
a identidade da sessão antes de buscar `roteiros`. A API de `roteiros` é
consultada somente por ordem e operação e pode devolver um `nrFicha` diferente;
por isso, após validar que há uma única definição de roteiro, o BFF a associa ao
`nrFicha` pendente confirmado. Uma ficha ausente das pendências ou uma definição
de roteiro vazia/ambígua continua sendo recusada com `invalid-upstream-response`.

| Método | Endpoint BFF                                         | Uso                                                                                                                                             |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/quality-control/route-authorizations`          | Lista fichas pendentes por `nrOrdemProducao` e `opCodigo`.                                                                                      |
| `POST` | `/api/quality-control/route-authorizations/route`    | Confirma `nrFicha` nas pendências da ordem/operação e associa a definição única do roteiro à ficha autorizada.                                  |
| `PUT`  | `/api/quality-control/route-authorizations/results`  | Salva um componente com `nrFicha`, `codExame`, `codComponente` e exatamente uma representação: `resultado`, `nrTabela` + `seqOpcao` ou `laudo`. |
| `POST` | `/api/quality-control/route-authorizations/finalize` | Solicita a finalização autorizada da ficha informada por `nrFicha`.                                                                             |

As rotas de carregamento, salvamento e finalização rejeitam métodos incorretos e
retornam `403` quando a sessão não possui `fcq-0002`. O BFF encaminha ao Datasul
somente os identificadores e valores necessários, preservando a identidade da
sessão autenticada.

### Estado da análise

O GET de autorização devolve os resultados já registrados em `resultados[]` e o
campo `dentroFaixa` de cada componente. O frontend não recalcula essa decisão:
componentes com `dentroFaixa: true` começam como **Aprovado pelo Datasul** e ficam
bloqueados somente para visualização; componentes com `dentroFaixa: false`
começam como **Fora da faixa confirmado pelo Datasul**, permanecem editáveis e
devem ser corrigidos pelo supervisor. Depois de editar um componente fora da
faixa, ele volta a **Não verificado** e precisa ser salvo novamente antes da
finalização. O botão fica bloqueado enquanto houver rascunho alterado e não salvo,
carregamento, salvamento ou finalização em andamento; a resposta `finalizado` do
Datasul continua sendo a decisão final.

O contrato de exclusividade das representações (`resultado`, `nrTabela` com
`seqOpcao`, ou `laudo`) aplica-se ao corpo da **requisição**. O recibo de resposta
do Datasul pode trazer campos auxiliares e representações combinadas de acordo
com o tipo do componente. O BFF valida o envelope, a identidade, os totais e
`dentroFaixa`, sem exigir que o recibo repita a forma exclusiva enviada.

Uma resposta HTTP bem-sucedida de finalização não basta para concluir a operação.
Quando `finalizado` for `false`, a ficha permanece na lista e o painel continua
aberto, exibindo a `mensagem` de negócio retornada pelo Datasul, além dos totais e
pendências. A ficha só é removida da lista quando `finalizado: true`.

## Fluxo funcional esperado

1. O usuário informa ou seleciona a ordem de produção e a operação.
2. O frontend consulta os roteiros em análise para a empresa e o usuário autenticado.
3. A tela apresenta cada ficha pendente, seus totais e a quantidade de componentes fora da faixa.
4. O usuário abre a ficha no fluxo de roteiro já existente para consultar ou alterar os resultados permitidos.
5. Após a validação, o usuário solicita a finalização autorizada da ficha.
6. A interface confirma o sucesso apenas quando a resposta indicar `finalizado: true`.

> O carregamento e a alteração do conteúdo da ficha são realizados pelos endpoints BFF documentados acima. O BFF delega ao Datasul os contratos de [roteiros.md](./roteiros.md) e [result-exames.md](./result-exames.md); consumidores do frontend devem usar somente as rotas BFF, sem enviar credenciais, empresa ou usuário diretamente ao Datasul.

## Consultar roteiros pendentes de autorização

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/autorizacaoroteiros`
- Autenticação: HTTP Basic Auth
- Exemplo:

```http
GET /api/fcq/v1/autorizacaoroteiros?companyId=1&codUsuario=mjocelio&nrOrdemProducao=372562&opCodigo=10
```

### Parâmetros de consulta

| Parâmetro         | Tipo observado | Obrigatório | Descrição                                                                                  |
| ----------------- | -------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `companyId`       | integer        | Sim         | Identificador da empresa. O valor observado foi `1`.                                       |
| `codUsuario`      | string         | Sim         | Código do usuário que realizará a análise/autorização.                                     |
| `nrOrdemProducao` | integer        | Sim         | Número da ordem de produção.                                                               |
| `opCodigo`        | integer        | Sim         | Código da operação. A nomenclatura difere de `codOperacao`, usado na consulta de roteiros. |

### Resposta observada

- Status HTTP observado: `200 OK`
- Exemplo integral: [`examples/autorizacao-roteiros-372562-operacao-10-response.json`](./examples/autorizacao-roteiros-372562-operacao-10-response.json)

| Campo                                      | Tipo observado | Descrição                                                                                              |
| ------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| `total`                                    | integer        | Quantidade de itens do envelope de resposta.                                                           |
| `hasNext`                                  | boolean        | Indica se há uma próxima página. Não foram fornecidos parâmetros de paginação.                         |
| `items`                                    | array          | Lista de contêineres retornados pela API.                                                              |
| `items[].ds-autorizacao`                   | object         | Contêiner do conjunto de autorização retornado pela API atual.                                         |
| `items[].ds-autorizacao.roteirosEmAnalise` | array          | Fichas pendentes encontradas para os filtros informados.                                               |
| `roteirosEmAnalise[].nrFicha`              | integer        | Identificador da ficha a ser consultada e posteriormente finalizada.                                   |
| `roteirosEmAnalise[].nrOrdemProducao`      | integer        | Ordem de produção vinculada à ficha.                                                                   |
| `roteirosEmAnalise[].codItem`              | string         | Código do item produzido.                                                                              |
| `roteirosEmAnalise[].descricaoItem`        | string         | Descrição do item produzido.                                                                           |
| `roteirosEmAnalise[].sequenciaOperacao`    | integer        | Sequência da operação no roteiro.                                                                      |
| `roteirosEmAnalise[].situacao`             | integer        | Código da situação da ficha. O exemplo pendente retornou `2`.                                          |
| `roteirosEmAnalise[].liberada`             | boolean        | Indica se a ficha está liberada.                                                                       |
| `roteirosEmAnalise[].inspecionado`         | boolean        | Indica se a ficha já foi inspecionada.                                                                 |
| `roteirosEmAnalise[].componentesTotal`     | integer        | Total de componentes da ficha.                                                                         |
| `roteirosEmAnalise[].componentesForaFaixa` | integer        | Quantidade de componentes fora da faixa esperada.                                                      |
| `roteirosEmAnalise[].narrativa`            | string         | Narrativa associada à análise; veio vazia na evidência.                                                |
| `roteirosEmAnalise[].resultados`           | array          | Resultados já registrados para os componentes da ficha.                                                |
| `resultados[].nrFicha`                     | integer        | Ficha à qual o resultado pertence; deve coincidir com a ficha externa.                                 |
| `resultados[].codExame`                    | integer        | Código do exame do componente.                                                                         |
| `resultados[].codComponente`               | integer        | Código do componente, usado com `codExame` como identidade.                                            |
| `resultados[].tipoResultado`               | integer        | Tipo da representação do resultado.                                                                    |
| `resultados[].resultado`                   | number         | Valor numérico registrado.                                                                             |
| `resultados[].laudo`                       | string         | Laudo textual registrado, quando aplicável.                                                            |
| `resultados[].nrTabela`                    | integer        | Tabela de opções vinculada, quando aplicável.                                                          |
| `resultados[].seqComp`                     | integer        | Sequência do componente. Não representa `seqOpcao`.                                                    |
| `resultados[].dentroFaixa`                 | boolean        | Decisão do Datasul: `true` fica somente para visualização; `false` pode ser corrigido pelo supervisor. |

## Finalizar roteiro com autorização

- Método informado e observado na requisição: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/finalizaroteirosautorizado?companyId={companyId}`
- Autenticação: HTTP Basic Auth
- Content-Type: `application/json`
- Exemplo: `POST http://10.101.195.111:51080/api/fcq/v1/finalizaroteirosautorizado?companyId=1`

> A coleção exibida na lateral do Postman identifica essa operação como `PUT`, mas o seletor da requisição e a especificação fornecida usam `POST`. Confirmar o método oficial com o backend antes da implementação definitiva.

### Parâmetros de consulta

| Parâmetro   | Tipo observado | Obrigatório | Descrição                 |
| ----------- | -------------- | ----------- | ------------------------- |
| `companyId` | integer        | Sim         | Identificador da empresa. |

### Corpo da requisição

```json
{
  "nrFicha": 64461,
  "codUsuario": "Mjocelio"
}
```

| Campo        | Tipo observado | Obrigatório | Descrição                                                                     |
| ------------ | -------------- | ----------- | ----------------------------------------------------------------------------- |
| `nrFicha`    | integer        | Sim         | Ficha que será finalizada com autorização. Deve vir do resultado da consulta. |
| `codUsuario` | string         | Sim         | Código do usuário responsável pela autorização.                               |

### Resposta observada

- Status HTTP observado: `200 OK`
- Exemplo integral: [`examples/finaliza-roteiro-autorizado-ficha-64461-response.json`](./examples/finaliza-roteiro-autorizado-ficha-64461-response.json)

| Campo                            | Tipo observado | Descrição                                                                                        |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `items[].ds-finaliza`            | object         | Contêiner da finalização. Por conter hífen, exige acesso por colchetes em JavaScript/TypeScript. |
| `items[].ds-finaliza.roteiro`    | array          | Resultado da finalização de cada roteiro.                                                        |
| `roteiro[].nrFicha`              | integer        | Ficha processada.                                                                                |
| `roteiro[].situacao`             | integer        | Situação após a operação. O sucesso observado retornou `4`.                                      |
| `roteiro[].mensagem`             | string         | Mensagem de negócio pronta para apresentação ao usuário.                                         |
| `roteiro[].inspecionado`         | boolean        | Indica se o roteiro ficou inspecionado.                                                          |
| `roteiro[].finalizado`           | boolean        | Indicador principal de sucesso da finalização.                                                   |
| `roteiro[].componentesTotal`     | integer        | Total de componentes.                                                                            |
| `roteiro[].componentesSalvos`    | integer        | Componentes efetivamente salvos.                                                                 |
| `roteiro[].componentesPendentes` | integer        | Componentes que permaneceram pendentes.                                                          |
| `roteiro[].componentesForaFaixa` | integer        | Componentes fora da faixa aceitos mediante autorização.                                          |
| `roteiro[].exames`               | array          | Resumo dos exames vinculados à ficha.                                                            |
| `roteiro[].exames[].codExame`    | integer        | Código do exame.                                                                                 |

## Regras e cuidados para a implementação

- Não assumir que `total` representa diretamente a quantidade de fichas: no exemplo, `total` é `1`, enquanto `items[0]["ds-autorizacao"].roteirosEmAnalise` contém duas fichas.
- Tratar `items`, `ds-autorizacao`, `roteirosEmAnalise`, `roteiro` e `exames` ausentes ou vazios sem quebrar a tela.
- Validar que `resultados` tenha uma identidade única por exame/componente, pertença à ficha e seja coerente com `componentesTotal` e `componentesForaFaixa`.
- Não considerar apenas o status HTTP como sucesso: validar também `finalizado`, `componentesPendentes` e a mensagem retornada.
- Solicitar confirmação explícita antes da finalização autorizada, pois a ação aceita componentes fora da faixa.
- Impedir envios repetidos enquanto a finalização estiver em andamento e atualizar a listagem após o sucesso.
- Obter `codUsuario` da sessão autenticada; não manter usuário fixo no frontend.
- Preservar `codItem` como string, inclusive quando contiver somente dígitos.
- Os significados oficiais de `situacao = 2` e `situacao = 4` ainda precisam ser confirmados com a regra de negócio.
- A diferença de capitalização observada em `mjocelio` e `Mjocelio` sugere que a sensibilidade a maiúsculas/minúsculas deve ser confirmada.

## Evidência e limitações

Esta documentação foi produzida a partir das requisições, respostas e capturas fornecidas em 18/08/2026. Ela registra o comportamento observado e não substitui um contrato OpenAPI oficial. Não foram fornecidos exemplos de lista vazia, validação negada, erro de autenticação, erro de negócio ou indisponibilidade do backend.
