# Finalização de roteiros

Solicita a finalização de uma ficha de roteiro de inspeção para um usuário.

## Requisição

- Método: `PUT`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/FinalizaRoteiros?companyId={companyId}`
- Exemplo: `PUT http://10.101.195.111:51080/api/fcq/v1/FinalizaRoteiros?companyId=1`
- Autenticação: HTTP Basic Auth
- Content-Type: `application/json`
- Efeito: tentativa de finalização de um roteiro de inspeção

> O endpoint foi observado com `FinalizaRoteiros` nessa capitalização. As credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Sim | Identificador da empresa. O valor observado foi `1`. |

### Corpo da requisição

```json
{
  "nrFicha": 64377,
  "codUsuario": "Mjocelio"
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `nrFicha` | integer | Sim | Número da ficha de roteiro que deve ser finalizada. |
| `codUsuario` | string | Sim | Código do usuário que solicita a finalização. O valor observado foi `Mjocelio`. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/finaliza-roteiros-ficha-64377-response.json`](./examples/finaliza-roteiros-ficha-64377-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista dos resultados da tentativa de finalização. |
| `items[].ds-finaliza` | object | Contêiner do retorno de finalização. O nome contém hífen e exige acesso por colchetes em JavaScript/TypeScript. |
| `items[].ds-finaliza.roteiro` | array | Lista dos roteiros avaliados para finalização. |

### Resultado da tentativa

Cada item de `roteiro` contém:

- identificação e estado: `nrFicha`, `situacao`, `inspecionado` e `finalizado`;
- progresso: `componentesTotal`, `componentesSalvos` e `componentesPendentes`;
- retorno funcional: `mensagem`;
- detalhamento: `exames`.

Cada item de `exames` informa `nrFicha`, `codExame`, `componentesTotal`, `componentesSalvos` e `componentesPendentes`.

## Interpretação da resposta fornecida

A ficha `64377` não foi finalizada:

- `finalizado`: `false`;
- `inspecionado`: `false`;
- `componentesSalvos`: `0`;
- `componentesPendentes`: `6`;
- mensagem: `Roteiro 64377 ainda tem 6 componente(s) pendente(s) em 1 exame(s)`.

## Observações do contrato

- Esta é uma operação de escrita. Repetições, tentativas automáticas e sincronização offline precisam considerar a idempotência efetiva do endpoint, que não foi informada.
- `total: 1` indica que um resultado foi retornado, mas não confirma que o roteiro foi finalizado.
- O consumidor deve usar `finalizado`, `inspecionado`, `componentesPendentes` e `mensagem` para determinar o resultado funcional da tentativa.
- O significado do código `situacao: 2` precisa ser confirmado com a regra de negócio antes de ser convertido em uma enumeração.
- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
