# Análise e correção de roteiros para autorização

## Contexto

A tela **Autoriza Roteiro CQ** lista fichas que não puderam ser finalizadas. O
fluxo atual chama diretamente a finalização autorizada. Quando ainda existem
componentes pendentes, o Datasul responde com `finalizado: false`, mas a tela
apresenta apenas um erro genérico e não oferece meios de completar a ficha.

O programa Datasul `fcq-0002` concede a permissão de aplicação
`AUTORIZACAO_ROTEIRO_DIVERGENCIA`. Usuários com essa permissão devem conseguir
consultar a ficha selecionada, registrar resultados pendentes ou corrigir
resultados reprovados e, por fim, solicitar a finalização autorizada.

## Limitação temporária do contrato

O endpoint Datasul `Roteiros` ainda não devolve o resultado já registrado nem o
campo `dentroFaixa` em `ds-roteiro.exames[].componentes[]`. Portanto, a aplicação
não consegue distinguir resultados previamente aprovados, reprovados e
pendentes ao abrir a análise.

Enquanto esse contrato não for ampliado:

- todos os componentes serão apresentados inicialmente como **Não verificado**;
- nenhum componente receberá check verde com base apenas na consulta inicial;
- o usuário deverá preencher somente o que deseja concluir ou corrigir;
- somente componentes preenchidos e salvos durante a sessão serão enviados;
- o estado aprovado ou fora da referência será conhecido pela resposta do PUT
  de `ResultExames`;
- a resposta do Datasul continuará sendo a autoridade final sobre a conclusão
  da ficha.

A tela deverá informar essa limitação de maneira visível e não poderá inferir
aprovação comparando apenas limites numéricos locais.

## Experiência do usuário

### Abertura da análise

O botão **Analisar e finalizar** abrirá um painel lateral dedicado. O popup
existente permanecerá reservado à confirmação final.

O painel exibirá no cabeçalho:

- número da ficha;
- ordem de produção;
- operação consultada;
- código e descrição do item.

Antes dos componentes será exibido o alerta:

> **Atenção:** a consulta atual não informa os resultados já registrados no
> Datasul. Por isso, os componentes aparecem inicialmente como “Não
> verificado”. Preencha somente os componentes que precisam ser corrigidos ou
> concluídos. Após salvar, o status será atualizado conforme a resposta do
> Datasul.

### Exames e componentes

Os exames serão apresentados em seções. Cada componente mostrará descrição,
referência, equipamento, unidade e um controle compatível com
`tipoResultado`:

- tipos 1 e 4: entrada numérica com a precisão definida por
  `numeroDecimais`;
- tipo 2: seleção entre `opcoesResultado`;
- tipo 3: entrada textual de laudo;
- tipos desconhecidos: bloqueio do salvamento e mensagem de contrato não
  suportado.

Cada componente terá salvamento individual. Os estados visuais serão:

- **Não verificado**: neutro, editável;
- **Salvando**: controle e ação temporariamente bloqueados;
- **Aprovado**: check verde e controle bloqueado;
- **Fora da referência**: destaque vermelho e controle editável;
- **Erro ao salvar**: controle editável, valor digitado preservado.

O rodapé apresentará a quantidade de componentes verificados na sessão e as
ações **Cancelar análise** e **Finalizar com autorização**. A finalização não
exigirá que todos os componentes estejam verdes, pois componentes fora da faixa
podem ser aceitos pelo próprio fluxo de autorização.

### Finalização

**Finalizar com autorização** abrirá o diálogo de confirmação atual. Enquanto a
requisição estiver em andamento, novos salvamentos, fechamento e reenvios serão
bloqueados.

Em sucesso (`finalizado: true` e `componentesPendentes: 0`), o painel será
fechado e a ficha removida da lista. Em recusa funcional
(`finalizado: false`), o painel permanecerá aberto e exibirá a mensagem devolvida
pelo Datasul, incluindo o número de componentes e exames pendentes. Erros de
transporte ou contrato serão apresentados separadamente.

## Arquitetura

### Isolamento do fluxo de autorização

O fluxo normal do Plano Controle CQ usa a permissão `PLANO_CONTROLE_CQ`, estado
offline e Outbox. Ele não será reutilizado diretamente porque a autorização é
online, possui regras diferentes e não deve conceder implicitamente
`fcq-0001` a usuários de `fcq-0002`.

Serão criados endpoints BFF específicos sob
`/api/quality-control/route-authorizations`. Eles reutilizarão o cliente
Datasul, mas exigirão `AUTORIZACAO_ROTEIRO_DIVERGENCIA`:

1. `POST /api/quality-control/route-authorizations/route`
   - corpo: `nrFicha`, `nrOrdemProducao` e `codOperacao`;
   - chama `POST /api/fcq/v1/roteiros?companyid=...`;
   - localiza exatamente a ficha solicitada na resposta;
   - rejeita resposta vazia, ambígua ou com ficha diferente.

2. `PUT /api/quality-control/route-authorizations/results`
   - corpo: identidade da ficha, exame e componente mais exatamente uma
     representação de resultado: numérica, tabelada ou laudo;
   - chama `PUT /api/fcq/v1/resultexames?companyId=...`;
   - acrescenta `codUsuario` a partir da sessão autenticada;
   - devolve ao frontend o resultado funcional, principalmente
     `dentroFaixa`.

3. `POST /api/quality-control/route-authorizations/finalize`
   - permanece como endpoint final do fluxo;
   - passa a preservar a mensagem de negócio quando a finalização não for
     concluída.

Os endpoints normais `/routes` e `/results` continuarão exigindo
`PLANO_CONTROLE_CQ`. A permissão de `fcq-0002` não será ampliada para outros
fluxos da aplicação.

### Identidade e validação

O navegador nunca definirá `companyId` nem `codUsuario`. Ambos serão obtidos no
servidor, respectivamente da configuração e da sessão autenticada.

O servidor validará números inteiros positivos, o formato mutuamente exclusivo
das representações de resultado e a identidade da ficha retornada por
`Roteiros`. A aplicação não abrirá a análise caso o Datasul não devolva a
`nrFicha` selecionada.

O BFF validará envelopes e tipos antes de repassá-los ao navegador. Dados
sensíveis ou corpos de resultados não serão incluídos em logs.

### Frontend

O módulo `route-authorization` ganhará unidades separadas para:

- mapear a ficha completa e os resultados salvos;
- manter o estado transitório da análise;
- renderizar o painel lateral;
- construir payloads por tipo de resultado;
- coordenar carregamento, salvamento individual e finalização.

O estado da análise será descartado ao fechar o painel. Se houver valor digitado
e não salvo, o fechamento exigirá confirmação. Resultados confirmados pelo
Datasul não serão reenviados automaticamente.

## Fluxo de dados

1. O usuário consulta fichas pendentes.
2. Seleciona **Analisar e finalizar** em uma ficha.
3. O frontend solicita o roteiro completo informando a identidade esperada.
4. O BFF consulta o Datasul, valida e devolve apenas a ficha correspondente.
5. O painel cria rascunhos vazios e estado **Não verificado** para os
   componentes.
6. O usuário preenche e salva um componente.
7. O BFF injeta a identidade autenticada e envia o resultado ao Datasul.
8. `dentroFaixa: true` bloqueia o componente com check verde;
   `dentroFaixa: false` mantém o componente editável e destacado.
9. O usuário solicita a finalização autorizada.
10. A tela remove a ficha somente quando o Datasul confirmar a conclusão.

## Concorrência e falhas

- somente uma análise ficará aberta por vez;
- somente um salvamento por componente poderá estar ativo;
- a finalização bloqueará todos os salvamentos e ações destrutivas do painel;
- duplo clique não produzirá requisições repetidas;
- falhas de salvamento preservarão o rascunho;
- respostas atrasadas de uma análise fechada serão ignoradas;
- falha de carregamento não alterará a lista original;
- recusa funcional exibirá a mensagem de negócio, não um erro genérico;
- a ficha continuará disponível após qualquer falha ou recusa.

## Acessibilidade

- o painel receberá foco no título ao abrir;
- campos e mensagens terão associação semântica com o componente;
- estados não dependerão apenas de cor;
- mensagens de salvamento e finalização usarão regiões `aria-live`;
- o foco retornará ao botão da ficha ao fechar;
- ações bloqueadas terão estado disabled real, não apenas aparência visual.

## Testes

### Servidor

- permite os novos endpoints para `AUTORIZACAO_ROTEIRO_DIVERGENCIA`;
- retorna 403 para sessão sem essa permissão;
- mantém `/routes` e `/results` restritos a `PLANO_CONTROLE_CQ`;
- ignora `codUsuario` e `companyId` enviados pelo navegador;
- seleciona a `nrFicha` exata e rejeita resposta diferente ou ambígua;
- valida payloads numérico, tabelado e de laudo;
- rejeita payload com representações misturadas;
- preserva `dentroFaixa` retornado pelo Datasul;
- sanitiza contratos inválidos e falhas upstream.

### Frontend

- abre o painel para a ficha correta;
- mostra o alerta provisório;
- inicia todos os componentes como **Não verificado**;
- escolhe o controle correto para cada `tipoResultado`;
- envia somente componentes explicitamente salvos;
- mostra check verde e bloqueia após `dentroFaixa: true`;
- mantém editável e destaca após `dentroFaixa: false`;
- preserva rascunho após falha;
- confirma descarte de rascunho ao fechar;
- impede carregamentos, salvamentos e finalizações duplicados;
- mostra a mensagem real quando há pendências;
- remove a ficha somente com finalização confirmada.

### Integração

- usuário apenas com `fcq-0002` consulta, analisa, salva e finaliza uma ficha;
- usuário apenas com `fcq-0001` não acessa o fluxo de autorização;
- recusa por componentes pendentes mantém o painel e a ficha disponíveis;
- finalização bem-sucedida fecha o painel e atualiza a listagem.

## Evolução futura do contrato

Quando `Roteiros` passar a devolver os resultados existentes por componente, o
mapper poderá inicializar os estados sem alterar a estrutura do painel:

- sem resultado: **Pendente** e editável;
- `dentroFaixa: false`: **Fora da referência** e editável, com valor anterior;
- `dentroFaixa: true`: **Aprovado**, bloqueado e com check verde.

Essa evolução removerá o alerta temporário. Até lá, nenhum componente será
marcado como aprovado antes de um salvamento confirmado na sessão atual.
