# Logs locais do sistema, APIs e navegador

## Objetivo

Adicionar observabilidade temporária e segura ao servidor do Front Manufatura.
Os eventos principais devem aparecer no mesmo terminal iniciado por
`atualiza-front.bat` e também ser persistidos em arquivos locais rotacionados.
Erros relevantes do frontend devem ser enviados ao servidor e registrados no
mesmo fluxo.

Os logs são destinados à depuração do ambiente interno. Eles não substituem
monitoramento centralizado e nunca podem impedir o funcionamento da aplicação.

## Arquitetura

O servidor terá um logger único baseado em `winston` e
`winston-daily-rotate-file`, com dois destinos:

- console, em formato compacto e legível;
- arquivos JSON Lines em `APP_LOG_DIR`, um conjunto rotacionado por data e
  tamanho.

Um middleware Express criará ou normalizará um identificador de correlação para
cada requisição. No encerramento da resposta, ele registrará método, caminho sem
query string, status e duração. O identificador será devolvido no header
`X-Correlation-Id`.

Um endpoint `POST /api/client-logs` receberá apenas eventos frontend com schema
allowlisted. Um serviço Angular capturará erros globais e falhas HTTP relevantes
e enviará eventos de forma best-effort. Uma falha no próprio envio de log será
silenciosamente descartada para evitar recursão.

## Configuração

As seguintes variáveis serão documentadas em `.env.example`:

```env
APP_LOG_LEVEL=info
APP_LOG_DIR=logs
APP_LOG_RETENTION_DAYS=14
APP_LOG_MAX_SIZE=20m
```

Valores inválidos usarão defaults seguros. `APP_LOG_DIR` será resolvido pelo
servidor, nunca pelo navegador. A pasta `logs/` será ignorada pelo Git.

O `atualiza-front.bat` exibirá o caminho configurado ou o default `logs` antes
de iniciar o Node. A reversão do build HTTP já documentada no arquivo deverá ser
preservada.

## Eventos do servidor

O terminal e os arquivos registrarão:

- `system.start` com porta, ambiente e diretório de logs;
- `system.stop` com o sinal recebido;
- `system.uncaught_exception` e `system.unhandled_rejection` com erro sanitizado;
- `http.request.completed` com `correlationId`, método, caminho, status e
  duração;
- `http.request.aborted` quando o cliente interromper uma resposta;
- `client.error` ou `client.warning` para eventos aceitos do navegador;
- erros operacionais já conhecidos nos gateways, quando houver uma fronteira
  clara para associá-los ao `correlationId`.

Não serão registrados query strings, headers completos nem bodies.

## Eventos do navegador

O frontend enviará no máximo os seguintes campos:

```ts
interface ClientLogEvent {
  readonly level: 'error' | 'warn';
  readonly event: 'angular.error' | 'window.error' | 'promise.rejection'
    | 'http.failure' | 'capability.unavailable';
  readonly message: string;
  readonly route?: string;
  readonly stack?: string;
  readonly status?: number;
  readonly correlationId?: string;
  readonly occurredAt: string;
}
```

Mensagens serão limitadas a 1.000 caracteres e stacks a 4.000 caracteres.
Rotas serão registradas sem query string. Somente falhas HTTP serão enviadas;
sucessos já estarão cobertos pelo middleware do servidor. O próprio endpoint de
logs será excluído da captura para evitar loop.

O envio será best-effort com `fetch`, `keepalive: true` quando suportado, body
JSON e limite de uma tentativa. O logger não manterá fila offline.

## Segurança e sanitização

O logger aplicará sanitização recursiva com profundidade e tamanho limitados.
Chaves contendo os seguintes termos serão substituídas por `[REDACTED]`:

- `authorization`, `cookie`, `password`, `senha`;
- `token`, `secret`, `credential`, `credencial`;
- `payload`, `body`, `resultado`, `measurement`.

Caracteres de quebra de linha serão normalizados para impedir log injection.
Objetos `Error` serão reduzidos a nome, mensagem sanitizada e stack limitada.
Eventos frontend com campos extras, nível/evento inválido, data inválida ou body
acima de 16 KB serão rejeitados com `400` ou `413` e sem ecoar o conteúdo.

O endpoint aceitará no máximo 60 eventos por minuto por endereço IP. Ao exceder,
responderá `429`. A memória do limitador será limitada e entradas antigas serão
expiradas.

## Rotação e retenção

Os arquivos serão nomeados `app-YYYY-MM-DD.log`, com sufixo de rotação quando
atingirem 20 MB. Serão mantidos por 14 dias. O transport fará a manutenção sem
bloquear o processamento de requisições.

Falhas na criação da pasta ou escrita em disco serão reportadas no console
quando possível, mas o servidor continuará ativo. Nenhum erro do transport pode
causar rejeição de uma API de negócio.

## Integração e ordem dos middlewares

O middleware de correlação/log será registrado antes dos endpoints de login,
qualidade e apontamento, permitindo observar todas as APIs. Arquivos estáticos
podem ser omitidos do nível `info`; respostas de API e erros SSR serão mantidos.

O endpoint de logs do navegador será instalado antes do renderizador Angular.
O logger não dependerá de autenticação para capturar falhas ocorridas durante o
login, mas aplicará schema, limite de body e rate limit.

## Testes e critérios de aceite

Serão criados testes para confirmar:

1. sanitização de segredos, quebras de linha, tamanho e profundidade;
2. correlação criada/devolvida e preservação de identificador válido recebido;
3. log de conclusão com método, caminho sem query, status e duração;
4. endpoint frontend aceita somente o schema definido e respeita 16 KB/60 por
   minuto;
5. captura Angular envia os eventos permitidos, ignora `/api/client-logs` e não
   propaga falha de logging;
6. configuração usa os defaults de 14 dias e 20 MB quando `.env` é inválido;
7. `logs/` está ignorado e o `.bat` informa onde os arquivos ficam;
8. suíte completa e build concluem com sucesso.

Aceitação manual no servidor Windows:

1. executar `atualiza-front.bat`;
2. confirmar `system.start` e requisições no terminal;
3. provocar uma rota inexistente e um erro frontend controlado;
4. confirmar os eventos no arquivo diário sem tokens, senhas ou bodies;
5. salvar um resultado e correlacionar a chamada usando `X-Correlation-Id`.

## Limites

Esta entrega não inclui painel para consulta, envio remoto, compactação de
arquivos ou busca full-text. A pasta local poderá ser copiada para análise. Logs
frontend não são garantia de entrega: se o servidor ou a rede estiverem
indisponíveis, o evento será descartado.
