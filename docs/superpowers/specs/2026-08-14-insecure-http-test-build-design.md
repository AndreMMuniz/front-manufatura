# Build temporário para testes via HTTP em IP interno

## Contexto

O frontend é acessado por outros computadores em
`http://10.101.195.236:4000`. O navegador não considera uma origem HTTP com
IP remoto um contexto seguro, então não disponibiliza `crypto.randomUUID()`,
`crypto.subtle` nem Service Worker. O fluxo de resultados do controle de
qualidade depende dessas capacidades antes de enfileirar as chamadas ao
Datasul.

O ambiente é temporário, interno e deve funcionar somente online. Não é
viável configurar individualmente o navegador de cada usuário.

## Decisão

Será criado um build explícito `http-test`, separado do build normal. Apenas
esse artefato permitirá a execução em uma origem HTTP insegura.

- O build normal continuará exigindo as capacidades criptográficas do
  contexto seguro e manterá o comportamento atual.
- O build `http-test` será ativado por uma constante substituída durante o
  build, sem depender de configuração local em cada navegador.
- O `atualiza-front.bat` passará a usar o build `http-test` e conterá
  comentários claros mostrando como voltar ao build normal futuramente.
- O Service Worker será desabilitado no build `http-test`, pois não é
  suportado em HTTP por IP. O modo temporário será tratado como online-only.

## Geração de identidade e integridade

Quando o build `http-test` estiver ativo e `crypto.randomUUID()` não estiver
disponível, a aplicação gerará um UUID v4 usando
`crypto.getRandomValues()`. Essa API continua disponível no contexto HTTP e
mantém geração aleatória criptograficamente forte.

Quando `crypto.subtle.digest()` não estiver disponível, o build `http-test`
calculará SHA-256 em JavaScript. A saída continuará no mesmo formato
hexadecimal de 64 caracteres usado no modo seguro. O fallback ficará isolado
atrás da flag do build e terá vetores de teste conhecidos.

Se `crypto.getRandomValues()` também não existir, a operação continuará
falhando. Não será utilizado `Math.random()`.

## Configuração e atualização

O projeto ganhará:

- uma configuração Angular `http-test`;
- um script npm `build:http-test`;
- constantes separadas para o modo padrão e o modo temporário;
- substituição de arquivo apenas na configuração `http-test`.

O `atualiza-front.bat` executará `npm run build:http-test`. Próximo à linha,
comentários explicarão que a alteração é temporária e que, após publicar com
HTTPS, deve-se restaurar `npm run build`.

Não serão adicionadas credenciais ou endereços do Datasul ao bundle do
navegador. A configuração `.env` continuará sendo usada somente pelo servidor.

## Tratamento de erros

- Fora do build `http-test`, uma origem insegura continuará produzindo
  `CAPABILITY_UNAVAILABLE`.
- No build `http-test`, ausência de `getRandomValues()` produzirá erro de
  capacidade, sem geração fraca de identidade.
- Falhas no SHA-256 em JavaScript serão convertidas para os mesmos erros já
  utilizados pelo serviço de integridade.
- O estado de salvamento da tela deverá ser liberado se a geração da chave
  falhar de forma síncrona, evitando botões permanentemente desabilitados.

## Testes e critérios de aceite

Serão adicionados ou ajustados testes para confirmar:

1. O UUID do fallback possui formato UUID v4 e bits de variante corretos.
2. O fallback não é usado no build normal.
3. O SHA-256 em JavaScript produz os mesmos hashes de vetores conhecidos e do
   Web Crypto.
4. O Service Worker fica desabilitado no build `http-test` e permanece ativo
   no build de produção normal.
5. O erro síncrono ao criar uma identidade não deixa a tela em estado de
   salvamento.
6. `npm run build:http-test` e os testes relacionados concluem com sucesso.
7. Acessando o artefato por IP/HTTP, salvar resultado e finalizar roteiro
   conseguem entrar na fila e ser enviados enquanto houver conectividade.

## Limites conhecidos

O build `http-test` não transforma HTTP em transporte seguro. Tráfego e token
de sessão continuam sem proteção contra interceptação na rede. Ele é destinado
somente ao ambiente interno e temporário descrito. A solução definitiva
continua sendo HTTPS; quando ele estiver disponível, o `.bat` deverá voltar ao
build normal.
