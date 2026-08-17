# ParadaProgramada

Programa uma parada com data e hora de início e fim para uma área de produção, um centro de trabalho e um operador.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/programaparada?companyId={companyId}&codUsuario={codUsuario}`
- Exemplo: `POST http://10.101.195.111:51080/api/fma/v1/programaparada?companyId=1&codUsuario=mjocelio`
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

Exemplo integral normalizado: [`examples/parada-programada-company-1-area-4104-ctrab-pre-006-02-request.json`](./examples/parada-programada-company-1-area-4104-ctrab-pre-006-02-request.json)

```json
{
  "codAreaProduc": "4104",
  "codCtrab": "PRE-006-02",
  "codParada": "05",
  "dataInicioParada": "2026-09-01",
  "horaInicioParada": "08:00",
  "dataFimParada": "2026-09-01",
  "horaFimParada": "12:00",
  "codOperador": "00016570",
  "codEquipe": "",
  "qtdTempoMaq": 0,
  "qtdTempoExt": 0
}
```

> O corpo transcrito na evidência continha uma chave de abertura adicional (`{`) antes dos campos e não apresentava o fechamento correspondente. O exemplo acima preserva o objeto interno e normaliza somente a estrutura para formar um JSON válido. A captura não exibe o conteúdo da aba `Body`, portanto não é possível confirmar se a estrutura inválida foi efetivamente enviada.

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
| `qtdTempoMaq` | number | Não confirmado | Quantidade de tempo de máquina. O valor enviado foi `0`; a unidade precisa ser confirmada. |
| `qtdTempoExt` | number | Não confirmado | Quantidade de tempo externo. O valor enviado foi `0`; a unidade precisa ser confirmada. |

## Resposta fornecida

- Formato: JSON
- Status HTTP observado: `500 Internal Server Error`
- Exemplo integral: [`examples/parada-programada-company-1-area-4104-ctrab-pre-006-02-response-500.json`](./examples/parada-programada-company-1-area-4104-ctrab-pre-006-02-response-500.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `detailedMessage` | string | Mensagem detalhada genérica. O valor observado foi `Contact your system administrator`. |
| `code` | string | Código do erro. O valor observado foi `"500"`. |
| `message` | string | Mensagem do erro. O valor observado foi `Internal server error`. |

## Erro observado

- A chamada retornou o status HTTP `500 Internal Server Error`.
- O corpo retornado contém somente uma orientação genérica para contatar o administrador e não expõe a causa técnica ou funcional.
- Não foi observado `type`, `details`, identificador de correlação ou outro dado diagnóstico no JSON fornecido.

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- O parâmetro `pageSize` foi exibido pela interface com o valor `40`, mas estava desmarcado e não fez parte da URL executada.
- `codParada` e `codOperador` devem ser tratados como strings, pois os valores observados possuem zeros à esquerda.
- `codEquipe` foi enviado como string vazia (`""`), não como `null`.
- A correção estrutural do exemplo de requisição está explicitada acima; nenhum valor de campo foi alterado.
- A evidência não permite atribuir o erro `500` à formatação transcrita, às datas futuras ou a uma regra de negócio específica.
- O contrato de sucesso, as unidades de `qtdTempoMaq` e `qtdTempoExt` e o comportamento em repetição não foram informados.
- Como esta operação altera o planejamento de parada, chamadas de teste devem usar um ambiente controlado.
