# IniciarOrdemBatelada

Inicia o reporte de várias ordens de produção em uma única batelada para um operador, uma área e um centro de trabalho.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/iniciarordembatelada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/iniciarordembatelada?companyId=1&codUsuario=mjocelio`
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

Exemplo integral: [`examples/iniciar-ordem-batelada-company-1-ordens-372569-372571-request.json`](./examples/iniciar-ordem-batelada-company-1-ordens-372569-372571-request.json)

```json
{
  "codAreaProduc": "4114",
  "codCtrab": "DOBR-01-01",
  "dataInicioReporte": "2026-04-30",
  "horaInicioReporte": "09:35",
  "codOperador": "00016570",
  "codEquipe": "",
  "codFerramenta": "",
  "dataInicioSetup": "",
  "horaInicioSetup": "",
  "dataFimSetup": "",
  "horaFimSetup": "",
  "splits": [
    {
      "nrOrdemProducao": 372569,
      "opCodigo": 20,
      "numSplitOperac": 1
    },
    {
      "nrOrdemProducao": 372570,
      "opCodigo": 20,
      "numSplitOperac": 1
    },
    {
      "nrOrdemProducao": 372571,
      "opCodigo": 20,
      "numSplitOperac": 1
    }
  ]
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `codAreaProduc` | string | Não confirmado | Código da área de produção. |
| `codCtrab` | string | Não confirmado | Código do centro de trabalho. |
| `dataInicioReporte` | string | Não confirmado | Data de início do reporte, no formato observado `YYYY-MM-DD`. |
| `horaInicioReporte` | string | Não confirmado | Hora de início do reporte, no formato enviado `HH:mm`. |
| `codOperador` | string | Não confirmado | Código do operador. Deve permanecer string para preservar zeros à esquerda. |
| `codEquipe` | string | Não confirmado | Código da equipe. Foi enviado como string vazia. |
| `codFerramenta` | string | Não confirmado | Código da ferramenta. Foi enviado como string vazia. |
| `dataInicioSetup` | string | Não confirmado | Data de início do setup. Foi enviada como string vazia. |
| `horaInicioSetup` | string | Não confirmado | Hora de início do setup. Foi enviada como string vazia. |
| `dataFimSetup` | string | Não confirmado | Data de fim do setup. Foi enviada como string vazia. |
| `horaFimSetup` | string | Não confirmado | Hora de fim do setup. Foi enviada como string vazia. |
| `splits` | array | Não confirmado | Lista das ordens, operações e splits que serão iniciados em batelada. |
| `splits[].nrOrdemProducao` | integer | Não confirmado | Número da ordem de produção. |
| `splits[].opCodigo` | integer | Não confirmado | Código da operação. |
| `splits[].numSplitOperac` | integer | Não confirmado | Número do split da operação. |

## Resposta

- Formato esperado pela indicação recebida: JSON
- Status HTTP: não informado na evidência recebida
- Corpo da resposta: não observado; a captura fornecida mostra a área de resposta vazia

> Quando o JSON de retorno for disponibilizado, ele deverá ser preservado integralmente em `examples/` e sua estrutura documentada nesta seção.

## Observações do contrato

- Esta documentação descreve somente a requisição fornecida e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `codOperador` deve ser tratado como string, pois o valor observado possui zeros à esquerda.
- Campos sem valor foram enviados como string vazia (`""`), não como `null`.
- O corpo agrupa três ordens em `splits`: `372569`, `372570` e `372571`, todas com operação `20` e split `1`.
- Como esta operação altera o estado de várias ordens, chamadas de teste devem usar ordens autorizadas e um ambiente controlado.
- O comportamento em repetição, falha parcial e atomicidade da batelada não foi informado e precisa ser confirmado antes da integração.
