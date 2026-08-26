# Desenho do item

Consulta o desenho técnico associado a um item e retorna o arquivo PDF codificado
em Base64. A chamada foi apresentada para uso na tela **Plano de Controle CQ**.

## Requisição

- Método: `GET`
- URL base observada: `http://10.101.195.111:51080`
- Endpoint: `/api/fcq/v1/desenhoitem`
- Exemplo: `GET http://10.101.195.111:51080/api/fcq/v1/desenhoitem?companyId=1&codUsuario=mjocelio&itCodigo=30907`
- Autenticação: HTTP Basic Auth, conforme o padrão observado nas chamadas desta API
- Corpo da requisição: não se aplica

> As credenciais de autenticação não devem ser armazenadas neste arquivo nem em
> exemplos versionados no repositório.

### Parâmetros de consulta

| Parâmetro | Tipo observado | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `companyId` | integer | Sim | Identificador da empresa. O valor observado foi `1`. |
| `codUsuario` | string | Sim | Código do usuário que realiza a consulta. O valor observado foi `mjocelio`. |
| `itCodigo` | string numérica | Sim | Código do item cujo desenho será consultado. Foi enviado como `30907` e retornado como a string `"30907"`. |

## Resposta observada

- Status HTTP: `200 OK`
- Formato: JSON
- Cardinalidade observada: `total: 1` e `hasNext: false`
- Tempo exibido pelo cliente de testes: `603 ms`
- Tamanho exibido pelo cliente de testes: `1.03 MB`

### Exemplo reduzido

O valor de `conteudoBase64` foi abreviado porque contém todo o arquivo PDF e
possui grande volume.

```json
{
  "total": 1,
  "hasNext": false,
  "items": [
    {
      "desenhoResultado": [
        {
          "tamanhoBytes": 1047348,
          "nomeArquivo": "30907_REV_R.pdf",
          "mensagem": "Desenho encontrado e carregado com sucesso",
          "rvCodigo": "R",
          "arquivoEncontrado": true,
          "itCodigo": "30907",
          "conteudoBase64": "JVBERi0xLjQ...",
          "caminhoCompleto": "/mnt/en0301/2D/30907_REV_R.pdf"
        }
      ]
    }
  ]
}
```

### Estrutura principal

| Campo | Tipo observado | Descrição |
| --- | --- | --- |
| `total` | integer | Quantidade de itens retornados no envelope. |
| `hasNext` | boolean | Indica se existe uma próxima página de resultados. |
| `items` | array | Lista de resultados da consulta. |
| `items[].desenhoResultado` | array | Lista dos desenhos encontrados para o item. |

### Resultado do desenho

| Campo | Tipo observado | Exemplo observado | Descrição |
| --- | --- | --- | --- |
| `tamanhoBytes` | integer | `1047348` | Tamanho informado para o arquivo, em bytes. |
| `nomeArquivo` | string | `30907_REV_R.pdf` | Nome do arquivo retornado. |
| `mensagem` | string | `Desenho encontrado e carregado com sucesso` | Mensagem funcional da consulta. |
| `rvCodigo` | string | `R` | Código de revisão do desenho. O significado formal da sigla ainda precisa ser confirmado. |
| `arquivoEncontrado` | boolean | `true` | Indica se o arquivo do desenho foi localizado. |
| `itCodigo` | string | `30907` | Código do item associado ao desenho. |
| `conteudoBase64` | string | `JVBERi0xLjQ...` | Conteúdo integral do PDF codificado em Base64. O prefixo observado é compatível com um PDF. |
| `caminhoCompleto` | string | `/mnt/en0301/2D/30907_REV_R.pdf` | Caminho interno do arquivo no servidor. Deve ser tratado apenas como metadado. |

## Orientação para consumo no frontend

- Usar `arquivoEncontrado` para decidir se há um arquivo disponível antes de
  tentar decodificar `conteudoBase64`.
- Decodificar `conteudoBase64` como PDF (`application/pdf`) e gerar uma URL de
  objeto para visualização ou download.
- Revogar a URL de objeto quando ela deixar de ser usada para evitar retenção de
  memória no navegador.
- Não registrar `conteudoBase64` em logs, telemetria ou mensagens de erro.
- Não construir uma URL de acesso a partir de `caminhoCompleto`; esse valor expõe
  a organização interna do servidor e não foi apresentado como rota pública.
- Considerar o volume da resposta nos estados de carregamento e no consumo de
  memória, pois o exemplo observado contém um arquivo de aproximadamente 1 MB.

## Pontos ainda não confirmados

- Respostas quando o item não possui desenho, incluindo status HTTP, mensagem e
  presença ou ausência de `desenhoResultado`.
- Respostas de validação para parâmetros ausentes ou inválidos.
- Possibilidade de mais de um item em `items` ou mais de um desenho em
  `desenhoResultado`.
- Existência e parâmetros de paginação, apesar da presença de `hasNext`.
- Valores possíveis e significado funcional completo de `rvCodigo`.
- Se o endpoint pode retornar formatos diferentes de PDF.
- Limite máximo de tamanho do arquivo e comportamento para arquivos grandes.

## Observações do contrato

- Esta documentação foi montada a partir de uma chamada e de uma resposta
  exibidas em capturas de tela; não substitui um contrato OpenAPI oficial.
- O conteúdo Base64 integral não foi disponibilizado e, por isso, não foi
  versionado em `examples`.
- A URL interna não pôde ser consultada a partir do ambiente de desenvolvimento
  durante a elaboração desta documentação.
- Os nomes e a capitalização dos campos foram preservados exatamente como
  observados na resposta.
