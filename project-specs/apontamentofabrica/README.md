# API de Apontamento de Fábrica

Esta pasta reúne as chamadas da API utilizadas na parte de **Apontamento de Fábrica**.

## Endpoints documentados

| Recurso | Método | Endpoint | Documentação |
| --- | --- | --- | --- |
| Centros de trabalho | `GET` | `/api/fma/v1/centrostrabalho` | [centros-trabalho.md](./centros-trabalho.md) |
| Ordens liberadas | `GET` | `/api/fma/v1/ordensliberadas` | [ordens-liberadas.md](./ordens-liberadas.md) |
| Abertura de apontamento | `GET` | `/api/fma/v1/abrirapontamento` | [abrir-apontamento.md](./abrir-apontamento.md) |
| Início de ordem | `POST` | `/api/fma/v1/iniciaordem` | [inicia-ordem.md](./inicia-ordem.md) |

## Autenticação

As chamadas observadas utilizam **HTTP Basic Auth** com as credenciais do Datasul.

As credenciais não devem ser armazenadas nesta pasta, versionadas no repositório, registradas em logs nem expostas ao frontend. Como a URL interna observada utiliza HTTP, a aplicação Angular deve acessar essas APIs por meio de um backend/proxy confiável na rede protegida; a comunicação entre o navegador e a aplicação deve utilizar HTTPS.

## Exemplos

Os corpos de requisição e as respostas integrais fornecidas ficam em [`examples`](./examples/) para preservar o contrato da API e facilitar consultas futuras.
