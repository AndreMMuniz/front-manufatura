# FinalizaParada

Finaliza uma parada de um centro de trabalho informando sua data e hora de término.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/finalizaparada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/finalizaparada?companyId=1&codUsuario=mjocelio`
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

Exemplo integral: [`examples/finalizar-parada-company-1-area-4113-ctrab-laser-01-01-request.json`](./examples/finalizar-parada-company-1-area-4113-ctrab-laser-01-01-request.json)

```json
{
  "codAreaProduc": "4113",
  "codCtrab": "LASER-01-01",
  "dataFimParada": "2026-08-14",
  "horaFimParada": "09:40"
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. |
| `dataFimParada` | string | Não confirmado | Data de fim da parada, no formato observado `YYYY-MM-DD`. |
| `horaFimParada` | string | Não confirmado | Hora de fim da parada, no formato observado `HH:mm`. |

## Resposta fornecida

- Formato: JSON
- Status HTTP observado: `500 Internal Server Error`
- Exemplo integral: [`examples/finalizar-parada-company-1-area-4113-ctrab-laser-01-01-response-500.json`](./examples/finalizar-parada-company-1-area-4113-ctrab-laser-01-01-response-500.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `detailedMessage` | string | Descrição detalhada do primeiro erro retornado. |
| `code` | string | Código do primeiro erro. O valor observado foi `"1"`. |
| `details` | array | Lista de detalhes adicionais do erro. |
| `message` | string | Mensagem do primeiro erro retornado. |
| `type` | string | Tipo do resultado. O valor observado foi `"error"`. |

### Erros em `details`

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `details[].detailedMessage` | string | Descrição detalhada do erro adicional. |
| `details[].code` | string | Código do detalhe. O valor observado foi `"2"`. |
| `details[].message` | string | Mensagem do erro adicional. |
| `details[].type` | string | Tipo do detalhe. O valor observado foi `"error"`. |

## Erro observado

- A API informou que a operação de finalizar a parada não era válida.
- O detalhe informou que já existia um reporte cadastrado com esse intervalo de tempo.
- As mensagens foram preservadas literalmente no exemplo de resposta, incluindo capitalização, acentuação e pontuação.

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- A resposta usa códigos de negócio `"1"` e `"2"` no corpo, embora o status HTTP observado tenha sido `500`.
- A evidência confirma a rejeição desta finalização específica, mas não informa qual parada aberta seria selecionada pela combinação de área e centro de trabalho.
- A relação exata entre a operação inválida e o reporte já cadastrado não foi informada; não é possível determinar pela resposta qual validação ocorreu primeiro.
- O contrato de sucesso e o comportamento em repetição não foram informados.
- Como esta operação altera o estado de parada, chamadas de teste devem usar um ambiente controlado.
