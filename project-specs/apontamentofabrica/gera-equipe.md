# GeraEquipe

Gera ou reaproveita uma equipe a partir de uma lista de operadores.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/geraequipe?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/geraequipe?companyId=1&codUsuario=mjocelio`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Content-Type: `application/json`

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário. O valor fornecido foi `mjocelio`. |
| `pageSize` | integer | Não | A interface exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada observada. |

### Corpo da requisição

Exemplo integral: [`examples/gera-equipe-company-1-operadores-00016570-00016590-request.json`](./examples/gera-equipe-company-1-operadores-00016570-00016590-request.json)

```json
{
  "codAreaProduc": "",
  "codCtrab": "",
  "operadores": [
    "00016570",
    "00016580",
    "00016590"
  ]
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. Foi enviado como string vazia. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. Foi enviado como string vazia. |
| `operadores` | array de strings | Não confirmado | Lista dos códigos dos operadores que compõem a equipe. Os valores devem permanecer strings para preservar zeros à esquerda. |

## Resposta fornecida

- Formato: JSON
- Status HTTP observado: `200 OK`
- Exemplo integral: [`examples/gera-equipe-company-1-operadores-00016570-00016590-response.json`](./examples/gera-equipe-company-1-operadores-00016570-00016590-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. O valor observado foi `1`. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. O valor observado foi `false`. |
| `items` | array | Lista de contêineres retornados pela chamada. |
| `items[].equipeResultado` | array | Lista com o resultado da geração ou do reaproveitamento da equipe. |
| `items[].operadores` | array | Lista dos operadores associados à equipe retornada. |

### Resultado da equipe

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `items[].equipeResultado[].codLider` | string | Código do líder retornado. O valor observado foi `"00016570"`. |
| `items[].equipeResultado[].jaExistia` | boolean | Indica se a equipe já existia. O valor observado foi `true`. |
| `items[].equipeResultado[].mensagem` | string | Mensagem sobre o resultado da operação. |
| `items[].equipeResultado[].codEquipe` | string | Código da equipe retornada. O valor observado foi `AUT0002`. |
| `items[].equipeResultado[].desEquipe` | string | Descrição da equipe retornada. |
| `items[].equipeResultado[].numTurno` | integer | Número do turno. O valor observado foi `1`. |

### Operadores retornados

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `items[].operadores[].codOperador` | string | Código do operador. Deve permanecer string para preservar zeros à esquerda. |
| `items[].operadores[].nomOperador` | string | Nome do operador retornado pela API. |

## Resultado observado

- A chamada retornou `200 OK`, com `total: 1` e `hasNext: false`.
- A equipe `AUT0002`, descrita como `Equipe Automatica AUT0002`, já existia e foi reaproveitada por possuir a mesma composição.
- O líder retornado foi `00016570` e o turno retornado foi `1`.
- Os três operadores enviados foram devolvidos com seus respectivos nomes.

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `codAreaProduc` e `codCtrab` foram enviados como strings vazias (`""`), não como `null`; o efeito funcional desses valores não foi informado.
- Os códigos de operadores e do líder devem ser tratados como strings, pois possuem zeros à esquerda.
- `codLider` coincide com o primeiro operador da lista nesta evidência, mas a regra de seleção do líder não foi informada.
- `jaExistia: true` e a mensagem retornada confirmam o reaproveitamento nesta chamada; o comportamento para uma composição inédita ainda precisa ser observado.
- Como esta operação pode criar ou reutilizar cadastros de equipe, chamadas de teste devem usar operadores autorizados e um ambiente controlado.
