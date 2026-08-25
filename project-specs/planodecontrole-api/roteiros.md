# Roteiros de inspeção

Consulta o roteiro de inspeção associado a uma ordem de produção e a uma operação, incluindo exames, componentes, limites de resultado e opções de resposta.

## Requisição

- Método: `POST`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/roteiros?companyid={companyId}`
- Exemplo: `POST http://10.101.195.111:51080/api/fcq/v1/roteiros?companyid=1`
- Autenticação: HTTP Basic Auth
- Content-Type: `application/json`

> As credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyid` | integer | Sim | Identificador da empresa. O valor observado foi `1`. |

### Corpo da requisição

```json
{
  "nrOrdemProducao": 372562,
  "codOperacao": 20,
  "codOperador": "00016570"
}
```

Para gerar o roteiro sob responsabilidade de uma equipe, substitua `codOperador` por
`codEquipe`:

```json
{
  "nrOrdemProducao": 372518,
  "codOperacao": 10,
  "codEquipe": "AUT00037"
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `nrOrdemProducao` | integer | Sim | Número da ordem de produção. |
| `codOperacao` | integer | Sim | Código da operação para a qual o roteiro será consultado. |
| `codOperador` | string | Condicional | Código do operador responsável. Exatamente um entre `codOperador` e `codEquipe` deve ser informado. |
| `codEquipe` | string | Condicional | Código da equipe responsável. Exatamente um entre `codOperador` e `codEquipe` deve ser informado. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/roteiros-372562-operacao-20-response.json`](./examples/roteiros-372562-operacao-20-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista dos roteiros encontrados. |
| `items[].nrFicha` | integer | Número da ficha de inspeção. |
| `items[].tipoResponsavel` | string | Tipo do responsável associado ao roteiro: `OPERADOR` ou `EQUIPE`. |
| `items[].codResponsavel` | string | Código do operador ou da equipe associado ao roteiro. |
| `items[].ds-roteiro` | object | Contêiner dos dados do roteiro. O nome contém hífen e exige acesso por colchetes em JavaScript/TypeScript. |
| `items[].ds-roteiro.exames` | array | Exames que compõem o roteiro de inspeção. |

### Exames

Cada item de `exames` descreve uma verificação do roteiro. Entre os campos observados estão:

- identificação: `codExame` e `versao`;
- descrição: `descricao` e `observacao`;
- execução: `responsavel`, `frequencia`, `amostra` e `nivel`;
- qualidade: `nqa`;
- detalhamento: `componentes`.

### Componentes

Cada componente representa um resultado a ser coletado durante o exame. Entre os campos observados estão:

- identificação: `codExame`, `codComponente` e `nrTabela`;
- descrição e orientação: `descricao`, `referenciaTecnica`, `metodo`, `equipamento` e `fonteDefinicao`;
- definição do resultado: `tipoResultado`, `unidade`, `numeroDecimais`, `resultadoMin` e `resultadoMax`;
- aprovação: `narrativaAprovacao`;
- respostas tabeladas: `opcoesResultado`, presente nos componentes que retornaram opções como `SIM` e `NÃO`.

### Opções de resultado

Quando presente, cada item de `opcoesResultado` contém `nrTabela`, `seqOpcao`, `codComponente`, `codExame` e `descricao`.

## Observações do contrato

- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O significado funcional dos códigos `tipoResultado`, `nivel`, `nrTabela` e demais enumerações numéricas precisa ser confirmado com a regra de negócio.
- Nem todos os componentes possuem `opcoesResultado`; o consumidor deve tratar esse campo como opcional.
- `codOperador` e `codEquipe` são mutuamente exclusivos; ambos ausentes, vazios ou preenchidos tornam a requisição inválida.
- Códigos de operador e equipe devem permanecer strings para preservar zeros à esquerda e prefixos alfanuméricos.
- Os limites numéricos devem respeitar `numeroDecimais` e a unidade informada pelo componente.
- A cardinalidade fornecida foi `total: 1` e `hasNext: false`, com a ficha `64379`, para a ordem `372562` e a operação `20`.
