# API de Apontamento de Fábrica

Esta pasta reúne as chamadas da API utilizadas na parte de **Apontamento de Fábrica**.

Os grupos de usuários e programas Datasul que controlam o acesso estão
consolidados em [Grupos de usuários e acessos Datasul para o frontend](../acessos-datasul-frontend.md).

## Endpoints documentados

| Recurso | Método | Endpoint | Documentação |
| --- | --- | --- | --- |
| Centros de trabalho | `GET` | `/api/fma/v1/centrostrabalho` | [centros-trabalho.md](./centros-trabalho.md) |
| Ordens liberadas | `GET` | `/api/fma/v1/ordensliberadas` | [ordens-liberadas.md](./ordens-liberadas.md) |
| Abertura de apontamento | `GET` | `/api/fma/v1/abrirapontamento` | [abrir-apontamento.md](./abrir-apontamento.md) |
| Início de ordem | `POST` | `/api/fma/v1/iniciaordem` | [inicia-ordem.md](./inicia-ordem.md) |
| Início de ordens em batelada | `POST` | `/api/fma/v1/iniciarordembatelada` | [iniciar-ordem-batelada.md](./iniciar-ordem-batelada.md) |
| Reporte de ordens em batelada | `POST` | `/api/fma/v1/reporteordembatelada` | [reporte-ordem-batelada.md](./reporte-ordem-batelada.md) |
| Reporte de ordem | `POST` | `/api/fma/v1/reporteordem` | [reporte-ordem.md](./reporte-ordem.md) |
| Encerramento de split | `POST` | `/api/fma/v1/encerrasplit` | [encerrar-split.md](./encerrar-split.md) |
| Início de parada | `POST` | `/api/fma/v1/iniciaparada` | [iniciar-parada.md](./iniciar-parada.md) |
| Inclusão de parada | `POST` | `/api/fma/v1/incluiparada` | [incluir-parada.md](./incluir-parada.md) |
| Parada programada | `POST` | `/api/fma/v1/programaparada` | [parada-programada.md](./parada-programada.md) |
| Finalização de parada | `POST` | `/api/fma/v1/finalizaparada` | [finalizar-parada.md](./finalizar-parada.md) |
| Eliminação de parada | `POST` | `/api/fma/v1/eliminaparada` | [eliminar-parada.md](./eliminar-parada.md) |
| Geração de equipe | `POST` | `/api/fma/v1/geraequipe` | [gera-equipe.md](./gera-equipe.md) |
| Alteração de equipe | `POST` | `/api/fma/v1/alteraequipe` | [altera-equipe.md](./altera-equipe.md) |
| Eliminação de parada programada | `POST` | `/api/fma/v1/eliminaparadaprogramada` | [eliminar-parada-programada.md](./eliminar-parada-programada.md) |
| Motivos de refugo | `GET` | `/api/fma/v1/motivosrefugo` | [motivos-refugo.md](./motivos-refugo.md) |
| Motivos de parada | `GET` | `/api/fma/v1/motivosparada` | [motivos-parada.md](./motivos-parada.md) |
| Paradas iniciadas | `GET` | `/api/fma/v1/paradasiniciadas` | [paradas-iniciadas.md](./paradas-iniciadas.md) |
| Operadores | `GET` | `/api/fma/v1/operadores` | [operadores.md](./operadores.md) |

## Datas e horas de produção

Conforme orientação do desenvolvedor do Datasul recebida em 14/10/2026, as datas de
início, reporte e setup devem ser enviadas como dia local `AAAA-MM-DD`, sem hora nem
fuso. Exemplo de turno noturno: início `2026-10-14` / `23:30` e fim `2026-10-15` /
`00:40`. Não extrair essas datas de `toISOString().slice(0, 10)`.

O frontend normaliza os campos de data na camada de transporte, preservando o
comando persistido, suas chaves de idempotência e os timestamps UTC de auditoria.
O gateway preserva e valida as datas de calendário. Por compatibilidade com
clientes anteriores, timestamps com fuso explícito são interpretados em
`America/Sao_Paulo`, independentemente do fuso do servidor. Horários sem fuso
misturados ao campo de data e datas no formato brasileiro são rejeitados.

As horas continuam separadas no formato `HH:mm` local usado pela integração.
A orientação confirma esse formato para início; para reporte, a conversão interna
para segundos depende do wrapper `reporteordem.p` e não foi confirmada no e-mail.
Esta correção não altera a unidade enviada nos campos de hora.

## Autenticação

As chamadas observadas utilizam **HTTP Basic Auth** com as credenciais do Datasul.

As credenciais não devem ser armazenadas nesta pasta, versionadas no repositório, registradas em logs nem expostas ao frontend. Como a URL interna observada utiliza HTTP, a aplicação Angular deve acessar essas APIs por meio de um backend/proxy confiável na rede protegida; a comunicação entre o navegador e a aplicação deve utilizar HTTPS.

## Exemplos

Os corpos de requisição e as respostas integrais fornecidas ficam em [`examples`](./examples/) para preservar o contrato da API e facilitar consultas futuras.
