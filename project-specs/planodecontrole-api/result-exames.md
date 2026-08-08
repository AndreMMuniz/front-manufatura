# Resultados de exames

Registra o resultado de um componente de exame associado a uma ficha de inspeção.

## Requisição

- Método: `PUT`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/resultexames?companyId={companyId}`
- Exemplo: `PUT http://10.101.195.111:51080/api/fcq/v1/resultexames?companyId=1`
- Autenticação: HTTP Basic Auth
- Content-Type: `application/json`
- Efeito: gravação de resultado de exame

> As credenciais de autenticação não devem ser armazenadas neste arquivo nem em exemplos versionados.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Sim | Identificador da empresa. O valor observado foi `1`. A capitalização difere do parâmetro `companyid` observado na chamada de Roteiros. |

### Corpo da requisição

```json
{
  "nrFicha": 64378,
  "codExame": 1845,
  "codComponente": 3,
  "nrTabela": 8,
  "seqOpcao": 1,
  "codUsuario": "Mjocelio"
}
```

| Campo | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `nrFicha` | integer | Sim | Número da ficha de inspeção. |
| `codExame` | integer | Sim | Código do exame. |
| `codComponente` | integer | Sim | Código do componente avaliado. |
| `nrTabela` | integer | Sim | Número da tabela de opções associada ao componente. |
| `seqOpcao` | integer | Sim | Sequência da opção selecionada na tabela. |
| `codUsuario` | string | Sim | Código do usuário responsável pelo registro. O valor observado foi `Mjocelio`. |

## Resposta fornecida

- Formato: JSON
- Status HTTP: não informado na evidência recebida
- Exemplo integral: [`examples/result-exames-ficha-64378-componente-3-response.json`](./examples/result-exames-ficha-64378-componente-3-response.json)

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens retornados. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista dos resultados gravados ou retornados pela operação. |

### Resultado do componente

Cada item de `items` contém:

- identificação: `nrFicha`, `codExame`, `codComponente`, `nrTabela`, `seqComp`, `numeroTeste` e `codItem`;
- resultado: `resultado`, `resultadoMinDefinido`, `resultadoMaxDefinido`, `resultadoMax`, `tipoResultado` e `dentroFaixa`;
- auditoria e data: `codResponsavel` e `dtResultado`;
- progresso: `componentesSalvos` e `componentesTotal`;
- informações complementares: `observacao` e `laudo`.

## Observações do contrato

- Esta é uma operação de escrita. Repetições, tentativas automáticas e sincronização offline precisam considerar a idempotência efetiva do endpoint, que não foi informada.
- Esta documentação descreve uma requisição e uma resposta fornecidas e não substitui um contrato OpenAPI oficial.
- O significado funcional de `tipoResultado`, `seqComp`, `numeroTeste` e dos limites retornados precisa ser confirmado com a regra de negócio.
- Na resposta fornecida, `dentroFaixa` foi `false`, embora a opção selecionada tenha sido `seqOpcao: 1`; a documentação preserva os valores recebidos sem inferir aprovação ou reprovação.
- A cardinalidade fornecida foi `total: 1` e `hasNext: false`, com `componentesSalvos: 6` de `componentesTotal: 6`.
