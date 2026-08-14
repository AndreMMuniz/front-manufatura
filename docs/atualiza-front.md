# Atualização e inicialização do front-end no servidor

O arquivo [`atualiza-front.bat`](../atualiza-front.bat) é a ferramenta de CD manual do Plano de Controle. Ele deve ser executado diretamente no servidor Windows sempre que uma nova versão da branch `main` precisar ser publicada.

## O que a ferramenta faz

O script executa as etapas abaixo em sequência:

| Etapa                    | Comando                                                         | Resultado                                                                   |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Acessar o projeto     | `cd /d C:\node\front-manufatura`                                | Define o diretório de trabalho no servidor.                                 |
| 2. Atualizar o código    | `git pull origin main`                                          | Baixa e integra a versão mais recente da branch `main`.                     |
| 3. Instalar dependências | `npm install`                                                   | Atualiza as dependências do projeto conforme o `package.json` e o lockfile. |
| 4. Gerar o build         | `npm run build`                                                 | Gera a aplicação Angular/SSR em `dist/plano-de-controle`.                   |
| 5. Iniciar o servidor    | `node --env-file=.env dist/plano-de-controle/server/server.mjs` | Inicia o servidor Node com as variáveis do `.env`.                          |

Se uma etapa falhar, o script mostra uma mensagem de erro, interrompe a execução e retorna o código de saída `1`. A etapa seguinte não é executada.

## Pre-requisitos do servidor

Antes de usar a ferramenta, confirme que o servidor possui:

- Windows com acesso ao Prompt de Comando;
- Git e Node.js disponíveis no `PATH`;
- o repositório clonado em `C:\node\front-manufatura`;
- acesso do repositório remoto `origin` ao GitHub;
- branch `main` disponível no remoto;
- arquivo `.env` válido na raiz do projeto;
- permissão para instalar dependências, gerar arquivos em `dist` e abrir a porta configurada pela aplicação.

O arquivo `.env` é obrigatório para esse script. Não publique seu conteúdo no Git nem copie segredos para logs ou documentação.

## Como executar uma atualização

1. Acesse o servidor Windows.
2. Encerre a instância anterior da aplicação, caso ela ainda esteja usando a porta configurada.
3. Abra o Prompt de Comando.
4. Execute o arquivo pela raiz do repositório:

   ```bat
   C:\node\front-manufatura\atualiza-front.bat
   ```

5. Acompanhe no terminal as mensagens das quatro etapas.
6. Mantenha a janela aberta enquanto a aplicação estiver em execução.
7. Ao final, valide a URL da aplicação e uma rota da API usada pelo front-end.

Uma execução bem-sucedida exibe a mensagem `[4/4] Iniciando servidor com .env...` e mantém o processo Node ativo no terminal. O script só continua para o `pause` final quando o servidor é encerrado ou falha.

## Diagnóstico de falhas

### `ERRO no git pull`

Verifique a conexão com o GitHub, as credenciais do Git, o remoto `origin` e se existem alterações locais ou conflitos que impedem a atualização. Não descarte alterações locais sem confirmar sua origem.

### `ERRO no npm install`

Verifique a versão do Node.js e do npm, o acesso ao registro de pacotes, o espaço em disco e as mensagens apresentadas imediatamente antes do erro.

### `ERRO no build`

O código foi atualizado e as dependências foram instaladas, mas o build não foi concluído. Corrija os erros exibidos por `npm run build` antes de tentar iniciar a nova versão.

### `ERRO ao iniciar o servidor`

Verifique se o `.env` existe e possui as configurações esperadas, se o build gerou `dist/plano-de-controle/server/server.mjs` e se a porta da aplicação já está em uso.

## Limites operacionais

- A ferramenta publica exclusivamente a branch remota `origin/main`.
- O caminho `C:\node\front-manufatura` está definido diretamente no arquivo.
- O script não cria backup nem desfaz automaticamente uma atualização com falha.
- O servidor Node roda em primeiro plano; fechar a janela encerra a aplicação.
- O script não gerencia o processo como serviço do Windows e não reinicia a aplicação automaticamente após reinicializações do servidor.
- Alterações locais no servidor podem impedir o `git pull` ou ser combinadas com a versão publicada. Mantenha o clone de produção sem edições manuais.

Se o caminho do repositório, a branch ou a forma de hospedar o processo mudar, atualize o `atualiza-front.bat` e este guia na mesma alteração.
