# IncluirParada

Inclui um reporte de parada com data e hora de início e fim para uma área de produção, um centro de trabalho e um operador.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/incluiparada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/incluiparada?companyId=1&codUsuario=mjocelio`
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

Exemplo integral: [`examples/incluir-parada-company-1-area-4104-ctrab-pre-006-01-request.json`](./examples/incluir-parada-company-1-area-4104-ctrab-pre-006-01-request.json)

```json
{
  "codAreaProduc": "4104",
  "codCtrab": "PRE-006-01",
  "codParada": "05",
  "dataInicioParada": "2026-08-20",
  "horaInicioParada": "09:00",
  "dataFimParada": "2026-08-20",
  "horaFimParada": "11:00",
  "codOperador": "00016570",
  "codEquipe": "",
  "numOmProgda": 0
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. |
| `codParada` | string | Não confirmado | Código da parada. Deve permanecer string para preservar o zero à esquerda no valor observado `"05"`. |
| `dataInicioParada` | string | Não confirmado | Data de início da parada, no formato observado `YYYY-MM-DD`. |
| `horaInicioParada` | string | Não confirmado | Hora de início da parada, no formato observado `HH:mm`. |
| `dataFimParada` | string | Não confirmado | Data de fim da parada, no formato observado `YYYY-MM-DD`. |
| `horaFimParada` | string | Não confirmado | Hora de fim da parada, no formato observado `HH:mm`. |
| `codOperador` | string | Não confirmado | Código do operador. Deve permanecer string para preservar zeros à esquerda. |
| `codEquipe` | string | Não confirmado | Código da equipe. Foi enviado como string vazia. |
| `numOmProgda` | integer | Não confirmado | Valor numérico relacionado à OM programada. O valor enviado foi `0`; o significado funcional precisa ser confirmado. |

## Resposta fornecida

- Formato: JSON
- Resultado observado: erro
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/incluir-parada-company-1-area-4104-ctrab-pre-006-01-response-error.json`](./examples/incluir-parada-company-1-area-4104-ctrab-pre-006-01-response-error.json)

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

- A API informou que não é permitido criar `Reporte Parada Centro Trab` para o futuro.
- O detalhe retornado foi `Data de Transação maior que Data do Processamento`.
- As mensagens foram preservadas literalmente no exemplo de resposta, incluindo capitalização, acentuação e pontuação.

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `codParada` e `codOperador` devem ser tratados como strings, pois os valores observados possuem zeros à esquerda.
- `codEquipe` foi enviado como string vazia (`""`), não como `null`.
- A evidência confirma a rejeição das datas enviadas, mas não informa qual relógio, fuso horário ou instante de processamento a API usa para determinar se uma transação está no futuro.
- O status HTTP, o contrato de sucesso e o comportamento em repetição não foram informados.
- Como esta operação altera o estado de parada, chamadas de teste devem usar um ambiente controlado.
