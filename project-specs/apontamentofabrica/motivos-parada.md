# MotivoParada

Consulta os motivos de parada disponíveis para os apontamentos de fábrica.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/motivosparada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `GET http://10.101.195.111:51080/api/fma/v1/motivosparada?companyId=1&codUsuario=mjocelio`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Corpo da requisição: não se aplica

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Não confirmado | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Não confirmado | Código do usuário. O valor fornecido foi `mjocelio`. |
| `pageSize` | integer | Não | A interface exibia o valor `40`, mas o parâmetro estava desmarcado e não participou da chamada observada. |

## Resposta fornecida

- Formato: JSON
- Status HTTP observado: `200 OK`
- Exemplo integral: [`examples/motivos-parada-company-1-response.json`](./examples/motivos-parada-company-1-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. O valor observado foi `1`. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. O valor observado foi `false`. |
| `items` | array | Lista de contêineres retornados pela consulta. |
| `items[].motivosParada` | array | Lista dos motivos de parada. A resposta fornecida contém 70 registros. |

### Motivos de parada

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `items[].motivosParada[].desParada` | string | Descrição da parada. |
| `items[].motivosParada[].paradaSetup` | boolean | Indica se o motivo representa uma parada de setup. |
| `items[].motivosParada[].codClasseMotivo` | string | Código da classe do motivo. Pode ser uma string vazia. |
| `items[].motivosParada[].emiteSolicitacaoServico` | boolean | Indica se o motivo emite solicitação de serviço. |
| `items[].motivosParada[].codParada` | string | Código da parada. Deve permanecer string para preservar zeros à esquerda. |

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- A resposta contém `total: 1`, `hasNext: false` e um único item com 70 registros em `motivosParada`.
- O primeiro registro possui `desParada`, `codClasseMotivo` e `codParada` vazios; ele foi preservado como parte do retorno observado e seu significado funcional precisa ser confirmado.
- `codParada` é string e inclui códigos com zeros à esquerda e códigos de comprimentos diferentes; não deve ser convertido para número.
- Quatro registros possuem `paradaSetup: true` e 66 possuem `false`.
- Todos os 70 registros possuem `emiteSolicitacaoServico: false` nesta resposta.
- As classes não vazias observadas foram `FER`, `LOG`, `M001`, `M101`, `PP001`, `PRO` e `SEG`; seu significado funcional precisa ser confirmado.
- Textos, capitalização, acentos, parênteses, barras e abreviações foram preservados literalmente no exemplo integral.
