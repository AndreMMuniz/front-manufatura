# Documentação de Entrega — Plano de Controle

## 1. Visão geral

O **Plano de Controle** é uma aplicação web para uso no chão de fábrica da Cortag. Ela digitaliza atividades do SFC (Sistema de Apontamento de Fábrica) e do controle de qualidade que antes dependiam de formulários, consultas e registros descentralizados.

A solução se integra ao **TOTVS Datasul**, que permanece como sistema oficial de usuários, permissões, ordens, operações, apontamentos e dados de qualidade. A aplicação oferece uma interface adequada para computadores industriais e tablets, além de continuidade operacional para parte dos lançamentos quando houver instabilidade de rede.

Principais áreas entregues:

- autenticação e autorização por programas do Datasul;
- seleção de centro de trabalho e gestão de equipes;
- reporte de operação, produção, refugo e retrabalho;
- reporte de produção por batelada;
- abertura, finalização e eliminação de paradas;
- plano de controle e registros de inspeção da qualidade;
- autorização de roteiros divergentes;
- central de acompanhamento e correção da sincronização.

## 2. Conceito da solução

A aplicação funciona como uma camada operacional entre o usuário da fábrica e o Datasul. O operador utiliza uma interface simplificada, enquanto o servidor da aplicação concentra autenticação, segurança, conversão de dados e comunicação com as APIs do ERP.

Nos lançamentos operacionais compatíveis com o modo offline, o registro é salvo primeiro no navegador e colocado em uma fila de saída (**Outbox**). A sincronização tenta entregar o comando ao servidor imediatamente ou assim que a conexão voltar. Cada comando possui uma chave de idempotência, evitando duplicidade em novas tentativas.

O Datasul continua sendo a fonte oficial dos dados. O armazenamento no navegador atua como diário local de entrega e contingência, não como substituto do ERP.

## 3. Tecnologias utilizadas

| Camada              | Tecnologia                       | Uso no projeto                                              |
| ------------------- | -------------------------------- | ----------------------------------------------------------- |
| Interface           | Angular 21 e TypeScript 5.9      | Aplicação web, navegação, formulários e regras de interface |
| Componentes visuais | PO-UI 21                         | Padrão visual e componentes corporativos                    |
| Comunicação         | RxJS e Angular HttpClient        | Chamadas assíncronas e controle dos fluxos                  |
| Servidor            | Node.js, Express 5 e Angular SSR | Hospedagem da aplicação, renderização e gateway de APIs     |
| Segurança           | JWT com `jose`                   | Sessão da aplicação e permissões por funcionalidade         |
| Operação offline    | PWA, Service Worker e IndexedDB  | Cache da aplicação, Outbox e retomada de sincronização      |
| Leitura de códigos  | ZXing                            | Apoio à leitura de códigos de barras pela câmera            |
| Observabilidade     | Winston                          | Logs estruturados, rotação e retenção de arquivos           |
| Testes              | Vitest e Playwright              | Testes unitários, integração, fluxo completo e PWA          |
| Build e pacotes     | Angular CLI e npm                | Desenvolvimento, testes e geração da versão de produção     |

## 4. Arquitetura

O repositório é uma aplicação única, organizada por funcionalidades. O build de produção contém o cliente Angular e o servidor Node/Express.

```text
Usuário (navegador/tablet)
        |
        v
Angular + PO-UI + PWA
        |-- estado de tela e regras de interação
        |-- IndexedDB / Outbox para continuidade local
        |
        v
Node.js + Express
        |-- Angular SSR e arquivos estáticos
        |-- autenticação, JWT e autorização
        |-- gateway das APIs e observabilidade
        |
        v
TOTVS Datasul
        |-- usuários e permissões
        |-- ordens, operações e equipes
        |-- apontamentos, paradas e qualidade
```

### Organização do código

- `src/app/core`: autenticação, comunicação HTTP, logs, navegação, PWA, IndexedDB e sincronização;
- `src/app/features`: módulos funcionais de login, equipes, apontamentos, paradas, qualidade e sincronização;
- `src/app/shared`: componentes reutilizáveis;
- `src/server.ts`: inicialização do servidor Express, SSR, arquivos estáticos e health check;
- `src/*-http-endpoint.ts`: endpoints oferecidos pelo gateway;
- `src/*-datasul-client.ts`: clientes responsáveis pela integração com o Datasul;
- `public`: manifesto, ícones e demais arquivos públicos;
- `tools`: automações de teste e implantação.

### Decisões principais

- **Feature-first:** cada área de negócio mantém páginas, componentes, modelos, DTOs, mapeadores e serviços próximos entre si.
- **Gateway/BFF:** o navegador chama somente `/api`; credenciais técnicas e particularidades do Datasul ficam no servidor.
- **Rotas protegidas:** a sessão e as permissões retornadas no login controlam o acesso às funcionalidades.
- **Local-first controlado:** comandos elegíveis são preservados no IndexedDB e sincronizados com política de repetição, integridade e idempotência.
- **SSR e PWA:** o mesmo servidor entrega a aplicação renderizada e seus arquivos; o Service Worker mantém o shell disponível após a primeira carga bem-sucedida.

## 5. Infraestrutura e implantação

### Estrutura atual

| Componente           | Responsabilidade                                                   |
| -------------------- | ------------------------------------------------------------------ |
| Navegador do usuário | Executar a interface Angular, o cache PWA e a base IndexedDB local |
| Servidor Windows     | Manter o repositório, gerar o build e executar o processo Node.js  |
| Node/Express         | Servir a aplicação e intermediar as chamadas ao Datasul            |
| TOTVS Datasul        | Autenticar, autorizar e persistir os dados corporativos            |
| GitHub               | Disponibilizar a branch `main` usada na atualização do servidor    |

O servidor utiliza a porta definida por `PORT`, com padrão `4000`. O endpoint `HEAD /api/health` é usado para validar a aplicação após a publicação.

A implantação atual é um **CD manual automatizado**:

1. o operador executa `atualiza-front.bat` no servidor Windows;
2. o script atualiza a branch `main` e instala as dependências;
3. um novo build é criado separadamente em `.deploy/candidate`;
4. o processo Node anterior é encerrado somente depois do build;
5. o novo build substitui o publicado e passa pelo health check;
6. em caso de falha, o script restaura automaticamente o build anterior.

O processo Node permanece em segundo plano, porém ainda **não é um serviço do Windows** e não reinicia automaticamente após uma reinicialização do servidor. Também não há pipeline de CI/CD, contêiner, proxy reverso ou configuração de HTTPS versionados neste repositório. O modo HTTP usado no script atual deve ser substituído pelo build normal quando o ambiente HTTPS estiver disponível.

O procedimento operacional completo está em [docs/atualiza-front.md](docs/atualiza-front.md).

## 6. Configuração do ambiente

Crie o arquivo `.env` na raiz com base em `.env.example`. Os grupos principais de configuração são:

- `PORT`: porta do servidor Node;
- `DATASUL_BASE_URL` e `DATASUL_REQUEST_TIMEOUT_MS`: endereço e timeout da integração;
- `DATASUL_COMPANY_ID`: empresa usada nas consultas;
- `DATASUL_INTEGRATION_USER` e `DATASUL_INTEGRATION_PASSWORD`: credencial técnica das integrações que a exigem;
- `APP_AUTH_TOKEN_SECRET`, `APP_AUTH_TOKEN_TTL_MS` e `APP_OFFLINE_SESSION_TTL_MS`: assinatura e duração das sessões;
- `APP_LOG_LEVEL`, `APP_LOG_DIR`, `APP_LOG_RETENTION_DAYS` e `APP_LOG_MAX_SIZE`: nível, destino, retenção e rotação dos logs.

O `.env` contém informações sensíveis e não deve ser versionado, enviado junto aos logs ou copiado para esta documentação.

## 7. Execução e validação

Pré-requisitos: Git, Node.js, npm e acesso de rede ao Datasul. No servidor de produção também são necessários Windows e PowerShell 5.1 ou posterior.

```bash
# instalar dependências
npm install

# executar em desenvolvimento
npm start

# gerar o build de produção
npm run build

# executar o build SSR gerado
npm run serve:ssr:plano-de-controle
```

Validações disponíveis:

```bash
# testes unitários
npm test -- --watch=false

# testes com cobertura e limites mínimos configurados
npm run test:ci

# testes de ponta a ponta
npm run e2e

# cenários específicos de PWA e atualização offline
npm run e2e:pwa
```

## 8. Segurança e operação

- A senha informada no login é encaminhada ao Datasul somente durante a autenticação e não deve ser armazenada ou registrada em logs.
- O JWT da aplicação é mantido em memória; a continuidade offline usa um retrato sanitizado, sem reutilizar o token online.
- As APIs operacionais exigem token e validam as permissões associadas aos programas do Datasul.
- Credenciais técnicas existem apenas no ambiente do servidor.
- Os logs da aplicação ficam, por padrão, em `logs`, com rotação diária ou por tamanho e retenção padrão de 14 dias.
- As saídas do processo publicado pelo script ficam em `.deploy/server-*.stdout.log` e `.deploy/server-*.stderr.log`.

## 9. Limites e recomendações para produção

- Disponibilizar HTTPS antes da operação produtiva fora de rede controlada.
- Configurar o Node como serviço do Windows, ou utilizar um gerenciador de processos equivalente, para reinício automático.
- Manter o clone de produção sem alterações locais para não bloquear o `git pull`.
- Proteger e rotacionar o segredo do JWT e as credenciais de integração.
- Monitorar espaço em disco, retenção de logs, disponibilidade do Datasul e falhas da Outbox.
- Adicionar pipeline de integração contínua para executar build e testes antes da publicação.
- Validar a política de backup do ambiente; o script mantém apenas um build anterior para rollback e não substitui backup corporativo.

## 10. Artefatos da entrega

- código-fonte da aplicação Angular e do gateway Node/Express;
- `package.json` e `package-lock.json` para instalação reproduzível das dependências;
- `.env.example` com a relação de configurações esperadas;
- `atualiza-front.bat` e `tools/deploy-front.ps1` para publicação no servidor Windows;
- testes unitários, de integração, E2E e PWA;
- documentação complementar na pasta `docs`.

Esta documentação descreve o estado do projeto na data da entrega e deve ser atualizada quando houver mudança relevante na arquitetura, infraestrutura ou processo de implantação.
