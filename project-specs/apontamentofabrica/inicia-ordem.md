# IniciaOrdem

Inicia o reporte de uma operação de uma ordem de produção para um operador, uma área e um centro de trabalho.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/iniciaordem?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/iniciaordem?companyId=1&codUsuario=mjocelio`
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

Exemplo integral: [`examples/inicia-ordem-company-1-ordem-372562-op-10-split-1-request.json`](./examples/inicia-ordem-company-1-ordem-372562-op-10-split-1-request.json)

```json
{
  "codAreaProduc": "4104",
  "codCtrab": "PRE-006-02",
  "nrOrdemProducao": 372562,
  "opCodigo": 10,
  "numSplitOperac": 1,
  "dataInicioReporte": "2026-07-21",
  "horaInicioReporte": "09:35",
  "codOperador": "00016570",
  "codEquipe": "",
  "codFerramenta": "",
  "dataInicioSetup": "",
  "horaInicioSetup": "",
  "dataFimSetup": "",
  "horaFimSetup": ""
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. |
| `nrOrdemProducao` | integer | Não confirmado | Número da ordem de produção. |
| `opCodigo` | integer | Não confirmado | Código da operação. |
| `numSplitOperac` | integer | Não confirmado | Número do split da operação. |
| `dataInicioReporte` | string | Não confirmado | Data de início do reporte, no formato observado `YYYY-MM-DD`. |
| `horaInicioReporte` | string | Não confirmado | Hora de início do reporte, no formato enviado `HH:mm`. |
| `codOperador` | string | Não confirmado | Código do operador. Deve permanecer string para preservar zeros à esquerda. |
| `codEquipe` | string | Não confirmado | Código da equipe. Foi enviado como string vazia. |
| `codFerramenta` | string | Não confirmado | Código da ferramenta. Foi enviado como string vazia. |
| `dataInicioSetup` | string | Não confirmado | Data de início do setup. Foi enviada como string vazia. |
| `horaInicioSetup` | string | Não confirmado | Hora de início do setup. Foi enviada como string vazia. |
| `dataFimSetup` | string | Não confirmado | Data de fim do setup. Foi enviada como string vazia. |
| `horaFimSetup` | string | Não confirmado | Hora de fim do setup. Foi enviada como string vazia. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/inicia-ordem-company-1-ordem-372562-op-10-split-1-response.json`](./examples/inicia-ordem-company-1-ordem-372562-op-10-split-1-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista de contêineres retornados pela chamada. |
| `items[].inicioOrdem` | array | Lista com o resultado do início da ordem. |

### Resultado do início da ordem

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `dataInicioReporte` | string | Data de início do reporte. |
| `opCodigo` | integer | Código da operação iniciada. |
| `horaInicioReporte` | string | Hora de início retornada pela API no formato observado `HHmm`. |
| `nrOrdemProducao` | integer | Número da ordem de produção iniciada. |
| `mensagem` | string | Mensagem retornada pela operação. |
| `codCtrab` | string | Código do centro de trabalho. |
| `numSplitOperac` | integer | Número do split da operação. |

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `horaInicioReporte` foi enviada como `09:35` e retornada como `0935`; o consumidor deve considerar essa diferença de formato.
- `codOperador` deve ser tratado como string, pois o valor observado possui zeros à esquerda.
- Campos sem valor foram enviados como string vazia (`""`), não como `null`.
- A resposta fornecida contém `total: 1`, `hasNext: false` e a mensagem `Reporte iniciado com sucesso` para a ordem `372562`, operação `10` e split `1`.
- Como esta operação altera o estado do reporte, chamadas de teste devem usar uma ordem autorizada e um ambiente controlado.
