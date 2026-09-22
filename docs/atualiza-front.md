# Deploy da aplicação no servidor Windows

O deploy é dividido em duas operações. [`atualiza-front.bat`](../atualiza-front.bat) e [`new-deploy.bat`](../new-deploy.bat) somente baixam os arquivos, instalam dependências e geram `.deploy/candidate`. Eles não param, instalam ou iniciam processos. Depois, [`instalar-servico.bat`](../instalar-servico.bat) publica o candidato e administra o serviço Windows.

O Node é executado pelo serviço Windows exibido como `fma service` (identificador interno `FmaService`), instalado pelo WinSW 2.12.0. Ele inicia automaticamente com o Windows (início atrasado) e reinicia 10 segundos após uma falha do processo. O Prompt pode ser fechado e não é necessário manter um usuário conectado.

## Instalar o serviço e migrar o Node antigo

Execute `instalar-servico.bat` **como Administrador**. Ele instala o serviço, para o serviço existente e encerra a instância Node antiga deste projeto na porta configurada. Em seguida, publica `.deploy/candidate`, inicia o `fma service` e valida `HEAD /api/health`.

Não ficam dois servidores concorrendo pela porta: o Node antigo é encerrado antes do `fma service` ser iniciado. Se a porta pertencer a outro programa, a operação é interrompida sem encerrá-lo. Na migração inicial, se não houver candidato mas já existir um build publicado, o instalador pode iniciar esse build como serviço. Ele não executa `git pull`, `npm install` nem build.

Se a nova versão falhar no health check, o build anterior é restaurado e reiniciado quando existe `.deploy/previous`. Não execute preparação e instalação simultaneamente.

O instalador baixa `WinSW.NET461.exe` v2.12.0 do [release oficial](https://github.com/winsw/winsw/releases/tag/v2.12.0), verifica SHA-256 e guarda o executável e XML em `.deploy/service`. É necessário .NET Framework 4.6.1 ou superior (recomendado 4.8). Em servidor sem acesso ao GitHub, copie esse executável para `.deploy/service/FmaService.exe`; o hash também será validado.

O serviço usa `NT AUTHORITY\LocalService`, sem senha no XML. O instalador concede leitura/execução na pasta do projeto e escrita apenas em `logs` e `.deploy/service/logs`. Instale Node para todos os usuários e use uma pasta local permanente. Se `APP_LOG_DIR` apontar para outro local, conceda escrita à conta do serviço nessa pasta. Recursos de rede que dependam da identidade Windows precisam de uma conta de serviço apropriada configurada pelo administrador.

O XML registra caminhos absolutos para Node, projeto e `.env`. Não mova a instalação nem remova `.deploy/service` com o serviço registrado. Atualizações reutilizam o XML e a conta existentes. Um serviço com o mesmo nome registrado em outra pasta bloqueia a operação.

Para administrar pelo PowerShell elevado:

```powershell
Get-Service FmaService
Stop-Service FmaService
Start-Service FmaService
Restart-Service FmaService
```

Para desinstalar somente o registro do serviço, pare-o e execute `.\.deploy\service\FmaService.exe uninstall` na raiz do projeto. Isso preserva build, configuração e logs; um deploy futuro reinstala o serviço.

Validação de scripts: `powershell.exe -NoProfile -File tools/windows-service.tests.ps1`. Os testes simulam SCM e HTTP; a workflow `Windows service scripts` também os executa em PowerShell 5.1. Na homologação Windows, confirme instalação, acesso à aplicação, reinício do computador, recuperação após falha do Node e atualização/rollback antes de liberar para produção.

## O que cada ferramenta faz

As etapas são deliberadamente separadas:

| Ferramenta | Ações | Altera o processo em execução? |
| --- | --- | --- |
| `new-deploy.bat` | Clona o repositório, preserva/cria `.env`, executa `git pull`, `npm install` e gera `.deploy/candidate`. | Não. |
| `atualiza-front.bat` | Executa `git pull origin main`, `npm install` e gera `.deploy/candidate`. | Não. |
| `instalar-servico.bat` | Instala/configura o serviço, para o Node anterior, publica o candidato, inicia e valida; faz rollback quando possível. | Sim. |

O processo atual continua no ar durante toda a preparação, inclusive se `git pull`, `npm install` ou o build falharem. A indisponibilidade esperada começa apenas quando `instalar-servico.bat` para o processo anterior para publicar o candidato.

Se o novo servidor não responder ao health check, o script executa rollback do build e reinicia a versão anterior. Ele retorna código `1` para deixar claro que a nova versão não foi publicada, mesmo quando o rollback foi bem-sucedido.

## Pre-requisitos do servidor

Antes de usar a ferramenta, confirme que o servidor possui:

- Windows; apenas `instalar-servico.bat` precisa de Prompt de Comando elevado (Executar como Administrador);
- .NET Framework 4.6.1 ou posterior para WinSW;
- Git e Node.js disponíveis no `PATH`;
- o repositório clonado no servidor (o caminho é detectado pela localização do próprio `.bat`);
- acesso do repositório remoto `origin` ao GitHub;
- branch `main` disponível no remoto;
- arquivo `.env` válido na raiz do projeto;
- PowerShell 5.1 ou posterior;
- permissão para instalar dependências, gravar em `dist` e `.deploy`, consultar processos e abrir a porta configurada pela aplicação.

O arquivo `.env` é obrigatório para esse script. Não publique seu conteúdo no Git nem copie segredos para logs ou documentação.

## Primeiro deploy em um servidor novo

Para preparar um servidor vazio, copie somente o arquivo [`new-deploy.bat`](../new-deploy.bat) para o servidor e execute-o pelo Prompt de Comando. Ele:

1. valida PowerShell, Git, Node.js e npm, mostrando as versões encontradas;
2. exige uma versão do Node.js compatível com o Angular (`20.19+`, `22.12+` ou `24+`);
3. clona a branch `main` do repositório público na mesma pasta onde `new-deploy.bat` foi colocado;
4. cria o `.env` como uma cópia de `.env.example`, sem sobrescrever um `.env` que já exista;
5. instala dependências e gera `.deploy/candidate`, sem iniciar a aplicação.

Depois que `new-deploy.bat` terminar, preencha o `.env` e execute `instalar-servico.bat` como Administrador. Não é obrigatório conhecer a URL do Datasul para preparar os arquivos, mas o login e as APIs integradas não funcionarão enquanto a configuração real não estiver no `.env`.

Antes do primeiro uso, coloque `new-deploy.bat` sozinho em uma pasta vazia. Como o Git não permite clonar diretamente em uma pasta que já contém o BAT, o instalador cria um clone temporário e move seu conteúdo para essa mesma pasta. Se ela contiver outros arquivos, o processo é interrompido sem sobrescrevê-los.

Se o diretório já contiver este repositório e um `.env`, ambos serão reutilizados e o `.env` será preservado. Qualquer requisito ausente ou etapa com falha interrompe a instalação e mantém o erro visível no Prompt. O único arquivo que precisa ser levado manualmente ao servidor novo é `new-deploy.bat`; os scripts PowerShell usados depois são obtidos pelo próprio clone.

## Como executar uma atualização

1. Acesse o servidor Windows.
2. Execute a preparação pela raiz do repositório (não precisa elevar o Prompt):

   ```bat
   C:\node\front-manufatura\atualiza-front.bat
   ```

3. Confirme a mensagem `PREPARACAO CONCLUIDA`. A versão antiga continua no ar.
4. Abra o Prompt de Comando como Administrador e execute:

   ```bat
   C:\node\front-manufatura\instalar-servico.bat
   ```

5. Confirme a mensagem `SERVICO ATUALIZADO` ou `SERVICO INSTALADO`.
6. Feche o Prompt se desejar; o processo continuará em segundo plano como `fma service`.

Na primeira execução de `instalar-servico.bat`, ele também encontra e encerra a instância iniciada manualmente pela versão antiga do `.bat`, desde que seja o Node deste projeto na porta definida por `PORT` (padrão `4000`).

## Build separado e tempo fora do ar

Não é seguro gerar o novo build diretamente sobre `dist/plano-de-controle` enquanto ele está publicado. O servidor entrega arquivos estáticos dessa pasta, e a limpeza feita pelo Angular durante o build pode produzir respostas incompletas ou misturar versões para usuários ativos.

Por isso, a ferramenta gera `.deploy/candidate` enquanto a aplicação antiga continua funcionando. A parada ocorre somente depois que o candidato está completo. A troca de diretórios e o novo startup normalmente levam poucos segundos. Zero downtime completo exigiria duas instâncias em portas diferentes e um proxy reverso para alternar o tráfego.

## Logs do servidor e das APIs

Os eventos da aplicação são gravados na pasta `logs` por padrão, uma linha por evento, com timestamp ISO 8601 em UTC, nível destacado, nome do evento e metadados em JSON. Exemplo: `2026-08-26T20:33:50.840Z [ERROR] api_request_completed | {"status":500}`. Esse formato facilita a leitura humana e mantém os metadados estruturados para filtros e análise. O WinSW grava stdout, stderr e diagnóstico em `.deploy/service/logs`; stdout/stderr giram a cada 10 MB, com até oito arquivos históricos. Os antigos arquivos `.deploy/server-*.stdout.log` e `.deploy/server-*.stderr.log` são preservados, mas não recebem novas execuções.

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

Verifique se o `.env` existe e possui as configurações esperadas, consulte `.deploy/service/logs` e o Visualizador de Eventos do Windows e confira se a porta está livre. Confirme também acesso da conta LocalService ao Node e à pasta do projeto. Se outro programa estiver usando a porta, a ferramenta recusa encerrá-lo por segurança.

### Nova versão falhou no health check

A ferramenta restaura `.deploy/previous` automaticamente. O front-end anterior permanece no ar, mas o deploy termina com erro. Consulte os logs em `.deploy` e `logs` antes de tentar novamente.

Valores inválidos nas variáveis `APP_LOG_*` também interrompem o startup com mensagem explícita. Já uma pasta sem permissão produz fallback somente para o terminal, sem interromper as APIs.

## Limites operacionais

- A ferramenta publica exclusivamente a branch remota `origin/main`.
- O backup cobre o build publicado; `git pull` e `npm install` não são revertidos.
- É mantido apenas um build anterior em `.deploy/previous`.
- O serviço inicia automaticamente após reinicialização. Recuperação automática cobre encerramento com falha; travamento com processo vivo exige intervenção/monitoramento externo.
- O modo `build:http-test` e o acesso HTTP por IP são temporários. Ao disponibilizar HTTPS, troque `build:http-test` por `build` na chamada de `Invoke-Checked` em `tools/deploy-front.ps1`.
- Alterações locais no servidor podem impedir o `git pull` ou ser combinadas com a versão publicada. Mantenha o clone de produção sem edições manuais.

Se o caminho do repositório, a branch ou a forma de hospedar o processo mudar, atualize o `atualiza-front.bat` e este guia na mesma alteração.
