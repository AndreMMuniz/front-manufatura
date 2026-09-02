# ParadasIniciadas

Consulta as paradas iniciadas para um centro de trabalho. O retorno inclui
`valReferInicParada`, referência que deve ser preservada e enviada ao finalizar
a mesma parada.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fma/v1/paradasiniciadas?companyId={companyId}&codUsuario={codUsuario}&codCtrab={codCtrab}`
- Exemplo: `GET http://10.101.195.111:51080/api/fma/v1/paradasiniciadas?companyId=1&codUsuario=mjocelio&codCtrab=LASER-01-01`
- Autenticação: HTTP Basic Auth com credenciais do Datasul
- Corpo da requisição: não se aplica

> Credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Sim na chamada observada | Identificador da empresa. O valor fornecido foi `1`. |
| `codUsuario` | string | Sim na chamada observada | Código do usuário que realiza a consulta. O valor fornecido foi `mjocelio`. |
| `codCtrab` | string | Sim na chamada observada | Código do centro de trabalho cujas paradas iniciadas serão consultadas. |

## Resposta fornecida

- Formato: JSON
- Status HTTP observado: `200 OK`
- Exemplo integral: [`examples/paradas-iniciadas-company-1-ctrab-laser-01-01-response.json`](./examples/paradas-iniciadas-company-1-ctrab-laser-01-01-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens de primeiro nível retornados. O valor observado foi `1`. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. O valor observado foi `false`. |
| `items` | array | Lista de contêineres retornados pela consulta. |
| `items[].paradasIniciadas` | array | Lista de paradas iniciadas para o centro de trabalho. |

### Paradas iniciadas

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `items[].paradasIniciadas[].numOmProgda` | integer | Valor numérico relacionado à OM programada. O valor observado foi `0`; o significado funcional exato precisa ser confirmado. |
| `items[].paradasIniciadas[].desParada` | string | Descrição do motivo da parada. |
| `items[].paradasIniciadas[].dataReporte` | string | Data do reporte, no formato observado `YYYY-MM-DD`. |
| `items[].paradasIniciadas[].valReferInicParada` | number | Código de referência usado para validar a parada. Deve ser tratado como valor opaco e preservado sem arredondamento ou formatação. Na resposta observada, `2.0260902555E12` representa o valor decimal `2026090255500`. |
| `items[].paradasIniciadas[].codUsuarReporte` | string | Código do usuário que reportou a parada. |
| `items[].paradasIniciadas[].horaInicioParada` | string | Hora de início da parada, no formato observado `HH:mm`. |
| `items[].paradasIniciadas[].horaReporte` | string | Hora do reporte, no formato `HH:mm` quando preenchida; veio vazia na resposta observada. |
| `items[].paradasIniciadas[].codCtrab` | string | Código do centro de trabalho. |
| `items[].paradasIniciadas[].dataInicioParada` | string | Data de início da parada, no formato observado `YYYY-MM-DD`. |
| `items[].paradasIniciadas[].codEquipe` | string | Código da equipe associada à parada. |
| `items[].paradasIniciadas[].codParada` | string | Código do motivo da parada. Deve permanecer string para preservar zeros à esquerda. |

## Mapeamento recomendado no gateway

| Campo Datasul | Campo público | Tipo público | Regra |
| --- | --- | --- | --- |
| `valReferInicParada` | `startReference` | string | Preservar uma representação decimal exata do número (`"2026090255500"` no exemplo observado), sem aplicar cálculos ou formatação regional. |

O campo público deve acompanhar a parada retornada por `GET /api/production-stops`
e ser reutilizado ao finalizar a mesma parada. No envio ao Datasul, o gateway
deve mapear `startReference` novamente para o campo numérico
`valReferInicParada` do body de `POST /api/fma/v1/finalizaparada`.

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O casing dos parâmetros e campos foi preservado conforme a chamada recebida.
- `valReferInicParada` é serializado como número JSON; a resposta observada do GET usa notação científica, enquanto a requisição observada de finalização usa notação decimal.
- O valor não deve ser presumido como inteiro: a requisição de finalização observada contém `20260902.50611`.
- O gateway deve publicar a referência como string para evitar perda de precisão durante o trânsito pelo frontend e convertê-la para número JSON somente na fronteira com o Datasul.
- A referência não deve ser reconstruída a partir de data, hora, centro de trabalho ou outros campos da parada.
- A finalização deve usar a referência devolvida para a parada selecionada; não pode reutilizar a referência de outra parada.
