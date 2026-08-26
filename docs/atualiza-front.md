# Deploy do front-end no servidor

O arquivo [`atualiza-front.bat`](../atualiza-front.bat) é a ferramenta de CD manual do Plano de Controle. Ele chama [`tools/deploy-front.ps1`](../tools/deploy-front.ps1), que prepara a nova versão, troca o build publicado, reinicia o Node e valida a aplicação automaticamente.

Não é mais necessário encerrar manualmente o servidor antes do deploy. Depois de uma publicação bem-sucedida, o Node permanece em segundo plano e o Prompt pode ser fechado.

## O que a ferramenta faz

O script executa as etapas abaixo em sequência:

| Etapa | Ação | Resultado |
| --- | --- | --- |
| 1 | `git pull origin main` | Baixa e integra a versão mais recente da branch `main`. |
| 2 | `npm install` | Atualiza as dependências conforme o `package.json` e o lockfile. |
| 3 | Build em `.deploy/candidate` | Gera a nova aplicação sem alterar o `dist` que ainda está atendendo usuários. |
| 4 | Localizar e parar o Node na porta configurada | Encerra somente o processo Node deste projeto; um processo estranho na mesma porta não é finalizado. |
| 5 | Trocar os diretórios | Move o build atual para `.deploy/previous` e publica o candidato em `dist/plano-de-controle`. |
| 6 | Iniciar e validar | Inicia o Node em segundo plano e consulta `HEAD /api/health`; se falhar, restaura o build anterior. |

O serviço atual continua no ar se `git pull`, `npm install` ou o build falharem. A indisponibilidade esperada acontece apenas entre a parada do processo antigo e a inicialização saudável do novo processo.

Se o novo servidor não responder ao health check, o script executa rollback do build e reinicia a versão anterior. Ele retorna código `1` para deixar claro que a nova versão não foi publicada, mesmo quando o rollback foi bem-sucedido.

## Pre-requisitos do servidor

Antes de usar a ferramenta, confirme que o servidor possui:

- Windows com acesso ao Prompt de Comando;
- Git e Node.js disponíveis no `PATH`;
- o repositório clonado no servidor (o caminho é detectado pela localização do próprio `.bat`);
- acesso do repositório remoto `origin` ao GitHub;
- branch `main` disponível no remoto;
- arquivo `.env` válido na raiz do projeto;
- PowerShell 5.1 ou posterior;
- permissão para instalar dependências, gravar em `dist` e `.deploy`, consultar processos e abrir a porta configurada pela aplicação.

O arquivo `.env` é obrigatório para esse script. Não publique seu conteúdo no Git nem copie segredos para logs ou documentação.

## Como executar uma atualização

1. Acesse o servidor Windows.
2. Abra o Prompt de Comando.
3. Execute o arquivo pela raiz do repositório:

   ```bat
   C:\node\front-manufatura\atualiza-front.bat
   ```

4. Acompanhe no terminal as seis etapas.
5. Confirme a mensagem `DEPLOY CONCLUIDO`.
6. Feche o Prompt se desejar; o processo Node continuará em segundo plano.

Na primeira execução da ferramenta nova, ela também encontra e encerra a instância iniciada manualmente pela versão antiga do `.bat`, desde que seja o Node deste projeto na porta definida por `PORT` (padrão `4000`).

## Build separado e tempo fora do ar

Não é seguro gerar o novo build diretamente sobre `dist/plano-de-controle` enquanto ele está publicado. O servidor entrega arquivos estáticos dessa pasta, e a limpeza feita pelo Angular durante o build pode produzir respostas incompletas ou misturar versões para usuários ativos.

Por isso, a ferramenta gera `.deploy/candidate` enquanto a aplicação antiga continua funcionando. A parada ocorre somente depois que o candidato está completo. A troca de diretórios e o novo startup normalmente levam poucos segundos. Zero downtime completo exigiria duas instâncias em portas diferentes e um proxy reverso para alternar o tráfego.

## Logs do servidor e das APIs

Os eventos da aplicação são gravados na pasta `logs` por padrão, uma linha por evento, com timestamp ISO 8601 em UTC, nível destacado, nome do evento e metadados em JSON. Exemplo: `2026-08-26T20:33:50.840Z [ERROR] api_request_completed | {"status":500}`. Esse formato facilita a leitura humana e mantém os metadados estruturados para filtros e análise. A saída e os erros do processo em segundo plano também são direcionados para arquivos `server-*.stdout.log` e `server-*.stderr.log` dentro de `.deploy`.

Os arquivos seguem o nome `application-AAAA-MM-DD.log`, giram diariamente ou ao atingir 20 MB e são mantidos por 14 dias. O arquivo `.application-log-audit.json` dentro da mesma pasta controla a retenção e não deve ser editado manualmente.

O `.env` aceita estas configurações opcionais:

| Variável                 | Padrão | Finalidade                                      |
| ------------------------ | ------ | ----------------------------------------------- |
| `APP_LOG_LEVEL`          | `info` | Nível mínimo: `debug`, `info`, `warn` ou `error`. |
| `APP_LOG_DIR`            | `logs` | Pasta absoluta ou relativa à raiz de execução.  |
| `APP_LOG_RETENTION_DAYS` | `14`   | Quantidade de dias de retenção.                 |
| `APP_LOG_MAX_SIZE`       | `20m`  | Tamanho máximo antes de criar outro arquivo.    |

Para usar outra pasta, configure somente o caminho no `.env`, por exemplo `APP_LOG_DIR=D:\logs\front-manufatura`. Não inclua credenciais no caminho e não mostre o conteúdo completo do `.env` durante o diagnóstico.

Se a gravação em arquivo falhar por permissão ou disco indisponível, a aplicação continua atendendo e mostra no terminal o aviso `server_log_file_unavailable`. Corrija a pasta e reinicie o processo para restabelecer os arquivos.

## Diagnóstico de falhas

### `ERRO no git pull`

Verifique a conexão com o GitHub, as credenciais do Git, o remoto `origin` e se existem alterações locais ou conflitos que impedem a atualização. Não descarte alterações locais sem confirmar sua origem.

### `ERRO no npm install`

Verifique a versão do Node.js e do npm, o acesso ao registro de pacotes, o espaço em disco e as mensagens apresentadas imediatamente antes do erro.

### `ERRO no build`

O código foi atualizado e as dependências foram instaladas, mas o candidato não foi concluído. A versão publicada continua atendendo. Corrija os erros exibidos antes de tentar novamente.

### `ERRO ao iniciar o servidor`

Verifique se o `.env` existe e possui as configurações esperadas, consulte o último `.deploy/server-*.stderr.log` e confira se a porta está livre. Se outro programa estiver usando a porta, a ferramenta recusa encerrá-lo por segurança.

### Nova versão falhou no health check

A ferramenta restaura `.deploy/previous` automaticamente. O front-end anterior permanece no ar, mas o deploy termina com erro. Consulte os logs em `.deploy` e `logs` antes de tentar novamente.

Valores inválidos nas variáveis `APP_LOG_*` também interrompem o startup com mensagem explícita. Já uma pasta sem permissão produz fallback somente para o terminal, sem interromper as APIs.

## Limites operacionais

- A ferramenta publica exclusivamente a branch remota `origin/main`.
- O backup cobre o build publicado; `git pull` e `npm install` não são revertidos.
- É mantido apenas um build anterior em `.deploy/previous`.
- O processo é gerenciado por PID/porta, mas ainda não é um serviço do Windows e não inicia automaticamente após reinicializar a máquina.
- O modo `build:http-test` e o acesso HTTP por IP são temporários. Ao disponibilizar HTTPS, troque `build:http-test` por `build` na chamada de `Invoke-Checked` em `tools/deploy-front.ps1`.
- Alterações locais no servidor podem impedir o `git pull` ou ser combinadas com a versão publicada. Mantenha o clone de produção sem edições manuais.

Se o caminho do repositório, a branch ou a forma de hospedar o processo mudar, atualize o `atualiza-front.bat` e este guia na mesma alteração.
