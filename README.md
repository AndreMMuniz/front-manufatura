# Plano de Controle

Aplicação web industrial da Cortag para digitalizar atividades de apontamento de fábrica e controle de qualidade integradas ao **TOTVS Datasul**.

O sistema reúne autenticação e autorização, centro de trabalho, equipes, reporte de operação e batelada, paradas, inspeções de qualidade e acompanhamento de sincronização. A interface é preparada para computadores industriais e tablets, com suporte PWA e persistência local para continuidade de lançamentos elegíveis durante instabilidades de rede.

> A visão completa de entrega, incluindo tecnologias, arquitetura, infraestrutura, segurança e recomendações operacionais, está em [DOCUMENTACAO-DE-ENTREGA.md](DOCUMENTACAO-DE-ENTREGA.md).

## Arquitetura resumida

```text
Angular 21 + PO-UI + PWA
        |
        | HTTP(S) / API
        v
Node.js + Express 5 + Angular SSR
        |
        | APIs Datasul
        v
TOTVS Datasul
```

- O front-end é organizado por funcionalidades, com componentes standalone.
- O servidor Express entrega o build SSR e atua como gateway seguro para o Datasul.
- A autenticação gera um JWT da aplicação e as rotas validam permissões funcionais.
- IndexedDB, Outbox e chaves de idempotência sustentam a operação local-first e a sincronização segura.
- O Datasul permanece como fonte oficial dos dados corporativos.

## Tecnologias principais

- Angular 21, TypeScript 5.9, RxJS e PO-UI 21;
- Node.js, Express 5 e Angular SSR;
- PWA, Service Worker e IndexedDB;
- Winston para logs;
- Vitest e Playwright para testes;
- npm e Angular CLI para build e execução.

## Início rápido

Pré-requisitos: Git, Node.js, npm e acesso ao ambiente Datasul.

```bash
npm install
cp .env.example .env
npm start
```

O servidor de desenvolvimento fica disponível, por padrão, em `http://localhost:4200`.

O arquivo `.env` deve ser preenchido com os dados do ambiente e nunca deve ser versionado. Consulte `.env.example` para ver as configurações necessárias.

## Comandos

```bash
npm start                    # desenvolvimento
npm run build                # build de produção
npm test -- --watch=false    # testes unitários
npm run test:ci              # testes com cobertura
npm run e2e                  # testes de ponta a ponta
npm run e2e:pwa              # testes específicos da PWA
npm run serve:ssr:plano-de-controle  # servidor do build gerado
```

## Implantação

A infraestrutura atual utiliza um servidor Windows com Node.js. A atualização é iniciada por `atualiza-front.bat`, que chama a automação PowerShell para atualizar a branch `main`, instalar dependências, gerar um build candidato, publicar, validar `HEAD /api/health` e restaurar a versão anterior em caso de falha.

Veja o [guia de atualização do servidor](docs/atualiza-front.md) para o procedimento completo.

## Estrutura principal

```text
src/app/core/       autenticação, HTTP, logs, navegação e operação offline
src/app/features/   módulos funcionais da aplicação
src/app/shared/     componentes compartilhados
src/server.ts       servidor Express, SSR e health check
tools/              automações de implantação e validação
docs/               documentação técnica e operacional complementar
```

## Segurança

- não registre senhas, JWTs ou credenciais de integração;
- mantenha o `.env` somente no ambiente de execução;
- utilize HTTPS em produção;
- proteja e rotacione o segredo de assinatura do JWT;
- mantenha o clone de produção sem alterações locais.

## Documentação

- [Documentação de entrega](DOCUMENTACAO-DE-ENTREGA.md)
- [Atualização e inicialização no servidor](docs/atualiza-front.md)
