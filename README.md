# HypeMeet

Salas para transmitir tela(s) e câmera com áudio. Dark, sem conta: apelido + código da sala. Quem entra
com o Discord também vê os canais de voz dos seus servidores.

- **Criar sala** com nome → gera código `ABC-DEF` pra mandar pra galera.
- **Salas salvas**: toda sala que você cria/entra aparece em **Grupos**, na barra da esquerda (localStorage
  do navegador). As salas de canal do Discord ficam no servidor delas.
- **Várias telas ao mesmo tempo** por pessoa, cada uma com seu próprio áudio.
- **Volume por stream, só pra você**: mutar ou ajustar de 0–200% cada tela e cada microfone.
- **Central de transmissões** (botão de tela na barra): lista cada tela que você está mandando, com
  **Parar** (uma ou todas), **modo** e **som** ajustáveis ao vivo, e prepara a próxima tela
  (modo + "Transmitir com som") antes de abrir o seletor. As escolhas da próxima tela ficam salvas.
- **Modo por tela**: "Jogo" (60 fps, 6 Mbps, prioriza fluidez) ou "Nitidez" (30 fps, 4 Mbps,
  prioriza resolução). Trocar numa tela já no ar ajusta captura, encoder e bitrate sem reabrir o seletor.
- **Escolher microfone, câmera e saída de áudio** nos chevrons dos botões; a escolha fica salva.
- Fixar (duplo clique) e tela cheia por tile.
- **Janela flutuante** (picture-in-picture): no tile da tela que você está assistindo, ou da câmera de
  alguém, solta a imagem numa janelinha do navegador por cima dos outros apps, pra acompanhar a live
  enquanto joga. Só a imagem vai pra lá: o som segue vindo da sala, com o volume que você escolheu. Fixar ou
  reorganizar os tiles não fecha a janela; ela fecha sozinha quando a tela para, a câmera desliga ou você
  para de assistir. Uma por vez (abrir em outro tile troca a imagem). Não aparece no Firefox, que não deixa
  o site abrir a janela.
- **Desenhar na tela de quem transmite**: lápis no tile da tela → caneta ou seta por cima da imagem,
  e um clique sem arrastar solta um "ping". Todo mundo que assiste aquela tela vê na hora (data channel
  do LiveKit, tópico `ink`), cada pessoa com sua cor. Os traços somem sozinhos uns segundos depois,
  já que a imagem embaixo continua mudando. Esc sai do modo desenho.
- **Entra mutado**: microfone e câmera começam desligados no lobby.
- **Tela só sob demanda**: a tela de outra pessoa aparece com "Ver transmissão" e só começa a
  chegar (vídeo + som) quando você clica; "Parar de assistir" no tile corta de novo.
- **Prévia da live**, como no Discord: enquanto você não assiste, o tile mostra uma miniatura da
  tela (selo "Ao vivo") atualizada a cada 10 s; quem acabou de entrar recebe a última na hora.
- **Quem está assistindo**: o tile de cada tela mostra um olho com os rostos e o número de quem
  assiste (nomes ao passar o mouse), inclusive pra quem transmite. Cada um publica as telas que
  assiste no atributo `viewing` do participante.
- **Sons da sala**: alguém entrou/saiu, você entrou/saiu, alguém entrou ao vivo (som próprio),
  sua tela começou, tela parou, mic ligado/mutado.
- **Assistir junto** (pipoca na barra): link do YouTube (vídeo ou **live**) ou vídeo do computador
  tocando sincronizado pra todo mundo, com play/pause/avanço/velocidade compartilhados ("Pausado por
  Fulano"). Cada um toca no próprio player, então sai mais leve que transmitir a tela e em qualidade
  original. O YouTube aparece com o **player do próprio YouTube** (controles, legendas, qualidade):
  o que qualquer um faz nele vale pra todos. Volume é só seu; "Minimizar" volta pras telas sem parar
  o som. **Parar de acompanhar** (no player ou na pipoca) tira o vídeo só pra você: nada carrega nem
  toca, a sessão segue pros outros e o tile "Assistir junto" te põe de volta no ponto em que estão.
  "Encerrar pra todos" termina a sessão. No vídeo do computador, atalhos com o player focado: espaço/K, ←/→ (5 s), J/L (10 s), F, M.
- **Chat de texto**: mensagens, links clicáveis e imagens (colar, arrastar ou escolher). Vai direto
  pelo data channel do LiveKit, sem passar pelo servidor nem ficar salvo: quem chega depois recebe o
  histórico de quem está há mais tempo na sala, e tudo some quando a sala esvazia.
- **Soundboard** (botão de megafone na barra): airhorn, BRUH, boom, tum dum tss, trombone triste e
  grilos, sintetizados na hora como os sons da sala e mixados no seu microfone — a galera ouve pela sua
  voz, e você ouve uma cópia na sua saída de áudio. Um som por vez (outro clique corta o anterior). Com
  o mic desligado/mutado (inclusive push-to-talk solto) o som só toca pra você, porque o servidor não
  repassa áudio de mic mutado.
- **Atividade do Discord**: abre dentro do Discord pelo 🚀 do canal de voz, com o nome e a foto de
  cada um, na sala daquele canal. A tela e a câmera saem de um transmissor no navegador e aparecem como
  suas, e a tela cheia ocupa a atividade inteira (veja [Atividade do Discord](#atividade-do-discord)).
- **Servidores do Discord no site**: entrando com o Discord, a barra da esquerda mostra seus servidores e,
  em cada um, os canais de voz e quem está na sala de cada canal (a mesma da atividade). A sala segue as
  permissões do canal: falar, vídeo, silenciar, ensurdecer, desconectar e convidar (veja
  [Servidores do Discord no site](#servidores-do-discord-no-site)).
- **Plugins** (botão de blocos na barra): apps de outros domínios que a sala abre junto, num iframe. Quem
  abre vira um tile pra todo mundo; cada um entra se quiser. O plugin só enxerga quem está na sala e
  conversa com as cópias dele nos outros navegadores por um tópico próprio do data channel (veja
  [Plugins](#plugins)). Primeiro plugin: o [Drawspace](https://github.com/victorgabrieldeon/drawspace), quadro branco ao vivo.
- **Prévia do convite**: colar `/r/ABCDEF` no WhatsApp/Discord/Telegram mostra um card com o nome da
  sala e quem está lá agora (`/r/:code/og.png`, gerado no servidor com satori + resvg). Só em produção,
  porque o servidor injeta as meta tags no `index.html`; a imagem dá pra ver no dev em
  `http://localhost:3001/r/<código>/og.png`. Emojis vêm do Twemoji (jsDelivr): sem internet, só eles somem.

## Stack

| Parte | Tecnologia |
| --- | --- |
| Mídia | [LiveKit](https://livekit.io) (SFU) — `livekit-client` no browser |
| Front | Vite + React 19 + TypeScript + Tailwind v4 |
| API | Bun (`server/index.ts`) + Postgres (o cliente que já vem no Bun, `Bun.SQL`) — salas, canais e sessões |
| Design | "Adesivo Noite": tokens em `src/index.css`, kit em `src/components/ui.tsx`; regras em [DESIGN.md](DESIGN.md) |

A API só guarda `código → nome` (mais o canal do Discord das salas de canal e as sessões de quem entra
com o Discord) e emite tokens LiveKit; vídeo/áudio vão direto browser ⇄ LiveKit.

## Rodando local

Requisitos: Bun ≥ 1.4, Docker.

```bash
bun install
bun run infra     # sobe o livekit-server em modo dev (devkey/secret) na 7880 e o Postgres na 5433
bun run dev       # API na 3001 + Vite na 5173
```

Só o banco: `bun run db`; só o LiveKit: `bun run livekit`. Sem `DATABASE_URL`, a API usa o Postgres do
`docker-compose.yml` (`postgres://hypemeet:hypemeet@localhost:5433/hypemeet`; a 5433 é pra não brigar com um
Postgres local na 5432) e cria as tabelas sozinha. Sem o banco no ar, ela não sobe.

`bun test` roda sem banco. Com `DATABASE_URL` apontando pra um Postgres, roda também os testes contra ele, cada
um num schema temporário (`test_…`) que é apagado no fim:
`DATABASE_URL=postgres://hypemeet:hypemeet@localhost:5433/hypemeet bun test`.

Abra http://localhost:5173.

### Testar com a galera na mesma rede

```bash
bun run dev:lan   # mesmo que dev, mas o Vite serve HTTPS (certificado autoassinado)
```

Os outros abrem `https://<ip-da-sua-máquina>:5173` e aceitam o aviso de certificado. HTTPS é
obrigatório: o navegador só libera câmera/tela em `localhost` ou HTTPS. A sinalização do LiveKit
passa pelo próprio Vite (`/rtc` → 7880), então só a mídia precisa da UDP 7882 liberada no firewall.

## Produção

```bash
bun run build
LIVEKIT_URL=wss://livekit.seudominio.com \
LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
DATABASE_URL=postgres://... \
PORT=3001 bun run start      # serve a API e o front buildado (dist/); recusa subir sem essas 4 variáveis
```

| Variável | Padrão | |
| --- | --- | --- |
| `LIVEKIT_URL` | dev: mesma origem via proxy `/rtc` | URL **pública** que o navegador usa (`wss://`). Obrigatória em produção |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | dev: `devkey` / `secret` | Mesmas chaves do servidor LiveKit. Obrigatórias em produção |
| `LIVEKIT_HOST` | `LIVEKIT_URL` (dev: `http://localhost:7880`) | URL que o servidor usa para consultar a API do LiveKit (quem está online). Em produção dá para apontar direto para a rede interna, ex. `http://livekit:7880` |
| `PORT` | `3001` | |
| `DATABASE_URL` | dev: `postgres://hypemeet:hypemeet@localhost:5433/hypemeet` | Postgres das salas, dos canais do Discord e das sessões. Obrigatória em produção |
| `DB_PATH` | `data/hypemeet.db` | Arquivo SQLite de antes do Postgres, copiado uma vez pro banco (veja [Banco de dados](#banco-de-dados)) |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | — | Ligam a [atividade do Discord](#atividade-do-discord) e o login com o Discord no site. Sem elas, `/api/discord/*` responde 503 e o site não oferece o login |
| `DISCORD_BOT_TOKEN` | — | Token do bot que lista os canais de voz dos [servidores do Discord](#servidores-do-discord-no-site), sincroniza as permissões, mostra quem está na call (pelo [Gateway](#gateway)) e modera no Discord. Sem ele, os servidores aparecem sem canais |
| `PLUGINS` | — | Endereços dos [plugins](#plugins) que as salas podem abrir, separados por vírgula (ex. `https://draw.exemplo.com`) |
| `PUBLIC_URL` | origem do pedido | Endereço do site (ex. `https://meet.exemplo.com`), usado nos links que saem da atividade do Discord (transmissor, "Abrir fora do Discord", convite) e no redirect do login com o Discord (`<PUBLIC_URL>/api/auth/discord/callback`, igual ao cadastrado no portal) |
| `YTDLP_COOKIES` | — | `cookies.txt` de uma conta do YouTube pro [YouTube no Discord](#atividade-do-discord) (ex. `/app/data/youtube-cookies.txt`). O yt-dlp reescreve o arquivo: tem que dar pra gravar |
| `YTDLP_PATH` | `yt-dlp` | Onde está o yt-dlp (a imagem Docker já traz, junto com o deno) |

O `docker-compose.yml` usa `--dev` — **não** use em produção. Para produção rode o LiveKit com
config própria (chaves fortes, TLS, portas UDP liberadas) ou use LiveKit Cloud.
Guia: https://docs.livekit.io/home/self-hosting/deployment/

### Dokploy (`docker-compose.prod.yml`)

Exemplo de deploy (projeto `hypemeet` no Dokploy, compose ligado ao repo
GitHub, branch `main`). O stack sobe o app (`Dockerfile`), o Postgres (volume `hypemeet-pg`) e um
LiveKit próprio. O app só sobe depois que o Postgres responde (healthcheck), e o volume `hypemeet-data`
continua: tem o SQLite antigo (de onde veio a cópia) e os cookies do yt-dlp.

| Serviço | Domínio (HTTPS pelo Traefik) | Portas no host |
| --- | --- | --- |
| `app` | `meet.exemplo.com` → 3001 | — |
| `livekit` | `livekit.exemplo.com` → 7880 (sinalização `wss://`) | 7881/tcp e 7882/udp (mídia) |

Variáveis do compose no Dokploy: `LIVEKIT_DOMAIN`, `LIVEKIT_NODE_IP` (IP público do servidor),
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (≥ 32 caracteres) e `POSTGRES_PASSWORD` (senha do banco, só com
letras, números, `-` e `_`: ela entra no `DATABASE_URL`, que o compose monta sozinho). Sem `POSTGRES_PASSWORD`
o compose nem sobe. O Postgres não abre porta no host: só o app fala com ele, pela rede do stack. As portas
7881/tcp e 7882/udp precisam estar abertas no firewall do servidor; sem elas a sala abre mas vídeo/áudio não
chegam.

A senha fica gravada no volume na primeira subida: trocar `POSTGRES_PASSWORD` depois não troca a do banco.
Pra trocar, mude no banco também (`ALTER USER hypemeet PASSWORD '…'`, pelo terminal do container no Dokploy).

### Banco de dados

O servidor cria as tabelas quando faltam (`server/db.ts`): `rooms`, `discord_channels`, `sessions` (só o
SHA-256 do cookie) e `meta`.

**Vindo do SQLite** (antes do Postgres): na primeira subida com o Postgres, se o arquivo `DB_PATH` existir, o
servidor copia salas, canais do Discord e sessões pro banco numa transação só, anota em `meta`
(`sqlite_imported`) e escreve no log quantas linhas vieram (`imported … 112/112 rooms, …`). Ele só lê o arquivo
(modo somente leitura), nunca muda nem apaga; depois da cópia ele não é mais usado, e o que já está no Postgres
não é sobrescrito. Pra copiar de novo (ex. o arquivo mudou depois da cópia), apague a marca:
`DELETE FROM meta WHERE key = 'sqlite_imported'` e reinicie; linhas repetidas são ignoradas.

**Backup**: `pg_dump`, do host (num cron, por exemplo) ou pelo terminal do container `postgres` no Dokploy:

```bash
docker exec <container do postgres> pg_dump -U hypemeet hypemeet > hypemeet-$(date +%F).sql
cat hypemeet-2026-11-08.sql | docker exec -i <container do postgres> psql -U hypemeet hypemeet   # restaurar num banco vazio
```

## Plugins

Um plugin é uma página web no próprio domínio. O servidor lista os de `PLUGINS` lendo o manifest de cada
um em `<endereço>/hypemeet-plugin.json`:

```json
{ "id": "drawspace", "name": "Drawspace", "description": "…", "icon": "/icon.svg", "entry": "/" }
```

`entry` e `icon` precisam estar no mesmo domínio do plugin, e um plugin no mesmo domínio do HypeMeet é
recusado (o sandbox do iframe não o seguraria). Na sala, o plugin roda num iframe e fala com a sala só por
`postMessage`, pelo SDK em [`sdk/hypemeet-plugin.ts`](sdk/hypemeet-plugin.ts) (arquivo único, sem
dependências: copie pro plugin):

- **Quem está na sala** e quem está com o plugin aberto (e desde quando).
- **Mensagens entre as cópias do plugin** nos navegadores da sala, no tópico `plugin:<id>` do data
  channel: confiáveis (até 8 MB, por text stream) ou com perda (até 1,2 KB, pra cursor e afins). O plugin
  não vê nem fala nos outros tópicos da sala.
- **Avisos** (`toast`) na sala.

Um plugin com servidor próprio que precisa saber quem chama (porque só serve pra quem está numa sala) põe
`"pass": true` no manifest. A sala então abre a página dele com `?pass=<passe>` no endereço. O passe vale
12 h e é preso ao id do plugin. O servidor do plugin pergunta quem é o dono do passe com
`POST <HypeMeet>/api/plugins/pass { "pass": "…" }`, que devolve `{ plugin, id, name, exp }` ou 401. Ele
precisa conferir se `plugin` é o próprio id. Só o HypeMeet consegue ler o passe, então não há segredo pra
dividir. Exemplo: o plugin do Budokai Tenkaichi 3 (repositório `bt3`).

Quem está com cada plugin aberto vai no atributo `plugins` do participante, então o tile aparece pra todo
mundo enquanto alguém usa e não há nada pra passar adiante quando alguém sai. O estado do plugin é
problema dele (o Drawspace, por exemplo, pede o quadro pra quem está há mais tempo).

**Na atividade do Discord** o plugin só aparece com um URL mapping `/plugins/<id>` → domínio dele (veja
[Configurar o app no Discord](#configurar-o-app-no-discord)): a CSP do Discord só deixa carregar o próprio
proxy. Lá ele divide o endereço com a sala, então roda sem `allow-same-origin` (origem opaca, `null`):
sem `localStorage` nem cookies, e tudo o que ele carrega vira pedido CORS. Pra funcionar ali, o plugin
precisa:

- estar na raiz do domínio dele (a sala confere `/plugins/<id>/hypemeet-plugin.json`; sem resposta, fica
  fora da atividade);
- usar caminhos relativos (`base: "./"` no Vite): sob o proxy ele mora em `/plugins/<id>/`;
- responder `Access-Control-Allow-Origin: *` e, se usar `frame-ancestors`, aceitar
  `https://*.discordsays.com https://discord.com https://*.discord.com`.

## Atividade do Discord

O HypeMeet também roda **dentro do Discord** como atividade (o 🚀 do canal de voz):

- **Entra direto**, sem lobby, com o nome e a foto do Discord. A foto aparece também pra quem está no
  site ou no app.
- **Uma sala por canal de voz**: todo mundo do canal cai na mesma sala, criada na primeira vez que alguém
  abre a atividade ali (ou o canal no site). Num servidor é a sala do canal no site e no app desktop, onde
  entrar pede login com o Discord e acesso ao canal (veja
  [Servidores do Discord no site](#servidores-do-discord-no-site)); numa DM é uma sala normal, com código.
- **Permissões do canal**: sem **Vídeo** no canal, o transmissor não manda câmera nem tela. Quem pode
  silenciar, ensurdecer ou desconectar no canal faz o mesmo pela lista de pessoas (o número de pessoas no
  topo), na sala e na call do Discord.
- **Convidar** oferece o convite do próprio Discord e o link da sala no site; **Sair** fecha a atividade.
- **Transmitir tela**: o Discord não deixa a atividade capturar a tela, então o botão de tela abre um
  **transmissor no navegador**. Você escolhe a tela lá e ela aparece na sala como sua, com o mesmo nome.
  O painel de tela da atividade lista o que está no ar e tem **Parar** / **Parar todas**. Deixe a aba
  do navegador aberta (pode minimizar); sair da atividade para a transmissão depois de 20 s.
- **Câmera**: o Discord também não libera a câmera pra atividades, então o botão de câmera abre o mesmo
  transmissor, que já liga a câmera (a escolhida da última vez nesse navegador). Ela aparece no seu quadro
  da sala; o botão da atividade desliga.
- **YouTube**: o Discord barra o player do YouTube dentro de atividades (só o Watch Together dele pode),
  então ali o **servidor repassa o vídeo**: o assistir junto funciona igual (colar o link, play e pausa
  pra todo mundo, entrar numa sessão começada fora), mas num player nosso, em geral em 360p e **sem
  lives**. O YouTube costuma barrar servidores ("confirme que não é um robô", 429): sem
  `YTDLP_COOKIES` (cookies de uma conta, de preferência uma descartável) pode falhar bastante. Quando falha,
  ou pra live, **Transmitir pelo navegador** (no player e no painel) abre o transmissor: cole o link em
  **Vídeo do YouTube**, escolha **esta aba** no seletor com o áudio ligado, e o vídeo entra na sala como sua
  tela, com som. No Chrome/Edge só o player vai (Region Capture); no Firefox vai a janela inteira, sem som.
  Vídeo do computador funciona normal.
- **Plugins** (o Drawspace, por exemplo): aparecem quando têm o URL mapping `/plugins/<id>` (veja
  [Plugins](#plugins)).
- **Tela cheia**: o iframe do Discord não libera a tela cheia do navegador, então lá o botão "Tela cheia"
  do tile faz a tela ocupar a atividade inteira (Esc sai). Junto com a tela cheia do próprio Discord
  (canto inferior direito da chamada, ou ↗ pra abrir em janela), cobre a tela toda.
- **Janelinha do Discord e janela flutuante**: quando o Discord encolhe a atividade na janelinha dele (você
  foi pra outro canal ou servidor), ela mostra só um vídeo, ocupando tudo: o da janela flutuante, o fixado, a
  primeira tela que você assiste ou a câmera de alguém. A janelinha aceita clique (`use_interactive_pip`, só no
  desktop e na web), e o botão "Janela flutuante" dela e dos tiles solta o vídeo numa janela do sistema, que
  fica por cima até com o Discord minimizado.
- **Sem microfone**: a voz é a do canal do Discord, então a atividade não tem botão de microfone nem
  soundboard (que sai pelo microfone), e os quadros não mostram o ícone de mic desligado.

### Configurar o app no Discord

Tudo em https://discord.com/developers/applications → seu app:

1. **OAuth2**: copie o *Client ID* e o *Client Secret* (vão nas variáveis abaixo). Em **Redirects**
   adicione os do login no site, exatamente assim: `<PUBLIC_URL>/api/auth/discord/callback` (ex.
   `https://meet.exemplo.com/api/auth/discord/callback`) e, pro dev,
   `http://localhost:5173/api/auth/discord/callback`. A atividade não usa redirect, mas o Discord exige ao
   menos um cadastrado.
2. **Activities → Settings**: ative as atividades e marque as plataformas (Desktop, Web, Mobile). A
   atividade só aparece nas plataformas marcadas.
3. **Activities → URL Mappings**. A ordem importa: o mais específico em cima.

   | Prefixo | Destino |
   | --- | --- |
   | `/livekit` | `livekit.exemplo.com` |
   | `/plugins/drawspace` | `draw.exemplo.com` |
   | `/` | `meet.exemplo.com` |

   O destino vai **sem** `https://`. O `/` é o site; o `/livekit` é a sinalização do LiveKit; cada
   [plugin](#plugins) ganha um `/plugins/<id>` (o `id` do manifest) apontando pro domínio dele.
4. **Installation**:
   - **Installation Contexts**: marque **User Install** (usar em qualquer lugar) e/ou **Guild Install**
     (adicionar a servidores).
   - **Install Link**: *Discord Provided Link*.
   - **Default Install Settings**: só o escopo `applications.commands`, sem `bot` nem permissões (com
     `bot`, a tela de instalação passa a pedir coisas como "Enviar mensagens"). O bot entra à parte, pelo
     link de cada servidor (passo 5).
5. **Bot**, pros [servidores no site](#servidores-do-discord-no-site) (a atividade sozinha não usa):
   **Reset Token** e copie o token, que vai em `DISCORD_BOT_TOKEN`. Não precisa de nenhum *Privileged
   Gateway Intent*. Com **Public Bot** desligado, só você consegue adicionar o bot a servidores.
6. Opcional: ícone e descrição em **General Information** e a capa da atividade em **Activities → Art
   Assets** (é o que aparece na lista do 🚀).

### Variáveis no servidor

| Variável | |
| --- | --- |
| `DISCORD_CLIENT_ID` | *Client ID* do app |
| `DISCORD_CLIENT_SECRET` | *Client Secret* do app. Nunca vai pro git: local fica no `.env` (ignorado), em produção nas variáveis do Dokploy |
| `DISCORD_BOT_TOKEN` | Token do bot (passo 5). Segredo como o de cima. Só pros [servidores no site](#servidores-do-discord-no-site); com ele o servidor abre uma conexão com o [Gateway](#gateway) |
| `PUBLIC_URL` | Endereço do site, ex. `https://meet.exemplo.com`. Usado nos links que saem da atividade (transmissor, "Abrir fora do Discord", convite copiado): lá dentro o pedido chega pelo proxy do Discord, então o servidor não sabe o próprio endereço. Também monta o redirect do login no site, `<PUBLIC_URL>/api/auth/discord/callback`; sem ela, vale a origem do pedido |

No Dokploy elas já estão no `docker-compose.prod.yml`; é só preencher e fazer redeploy. Sem as duas
primeiras, `/api/discord/*` responde 503 ("A atividade do Discord não está configurada no servidor") e o
site não oferece o login. Sem `DISCORD_BOT_TOKEN`, o login e a lista de servidores funcionam, mas os
servidores aparecem sem canais ("O HypeMeet ainda não está em …") e sem o link pra adicionar o bot.
Se o segredo vazar, gere outro em **OAuth2 → Reset Secret** e troque a variável; o token do bot, em
**Bot → Reset Token**.

### Instalar e abrir

- **Pra você, enquanto desenvolve**: ligue o **Modo de desenvolvedor** (Configurações → Avançado), entre
  num canal de voz e clique no 🚀. Apps seus (ou do seu time) aparecem sozinhos.
- **No seu usuário** (usar em qualquer servidor ou DM):
  `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&integration_type=1&scope=applications.commands`
- **Num servidor** (aparece pra todo mundo de lá; precisa de **Gerenciar Servidor**):
  `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&integration_type=0&scope=applications.commands`

Depois é só entrar num canal de voz → 🚀 → **HypeMeet**. Quem não enxergar o app enquanto ele não passa
pela verificação do Discord pode ser adicionado em **App Testers** no portal. O canal precisa deixar
**Usar Atividades** (vem ligado por padrão).

**Permissões que aparecem pra quem abre.** Na primeira vez o Discord pede login com os escopos
`identify` (nome, avatar e banner) e `guilds` ("saber em quais servidores você está"), este usado pra
tentar ler o nome do canal (no login do site, pra listar seus servidores). Pedidos como "enviar mensagens" não vêm do HypeMeet: vêm da configuração de
instalação (veja o passo 4 acima). Pra ver a tela de permissões de novo depois de mudar algo:
Configurações → **Aplicativos autorizados** → HypeMeet → **Desautorizar**, e abra a atividade outra vez.

### Testar local

1. Crie o `.env` (ignorado pelo git) com `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` e, pros servidores
   no site, `DISCORD_BOT_TOKEN`.
2. `bun run infra` e `bun run dev`.
3. Abra um túnel até o Vite: `cloudflared tunnel --url http://localhost:5173`. Ele imprime um endereço
   `https://<algo>.trycloudflare.com` (o Vite aceita esses hosts: `allowedHosts` no `vite.config.ts`).
4. Ponha esse endereço no `.env` como `PUBLIC_URL` (pro link do transmissor abrir no túnel) e reinicie
   o `bun run dev`.
5. No portal, troque o mapping `/` pelo endereço do túnel, sem `https://`. O `/livekit` não é usado no
   dev: o Vite já repassa `/rtc` pro LiveKit local.
6. Abra a atividade no Discord. Mudanças no front chegam com o recarregar da atividade.
7. YouTube: precisa do [yt-dlp](https://github.com/yt-dlp/yt-dlp) no `PATH` (e do deno, ou ele usa o Bun).
   Plugins: o Vite do plugin não serve sob `/plugins/<id>/`, então rode o build dele (`bun run build &&
   bun run start` no Drawspace) e aponte o mapping `/plugins/<id>` pra outro túnel até ele.

O endereço do túnel muda toda vez que ele reinicia. Ao terminar, volte o mapping `/` pra produção:
enquanto ele apontar pro túnel, a atividade só abre com a sua máquina ligada.

**Login no site em dev.** Sem `PUBLIC_URL`, entre por http://localhost:5173: o redirect usa a origem do
pedido (`http://localhost:5173/api/auth/discord/callback`). Com `PUBLIC_URL` no túnel (passo 4), o login
volta pelo túnel: entre pelo endereço dele e cadastre `<túnel>/api/auth/discord/callback` nos
**Redirects**. Começando em localhost, a volta cai no túnel sem o cookie do login e falha.

### Como funciona por dentro

- **Detecção** (`src/lib/discord.ts`): o Discord serve a página em `https://<client id>.discordsays.com`
  com `frame_id` na URL. Nesse caso o `main.tsx` mostra a atividade (`src/pages/DiscordActivity.tsx`)
  no lugar das rotas, e só aí carrega o [Embedded App SDK](https://github.com/discord/embedded-app-sdk).
- **Proxy**: todo o tráfego da atividade passa pelo proxy do Discord, que só leva HTTP e WebSocket. O
  `/api` funciona como está (mapping `/`); a URL do LiveKit é trocada por
  `wss://<client id>.discordsays.com/livekit` (mapping `/livekit`).
- **Login**: `sdk.ready()` → `authorize` (consentimento só na primeira vez) → `/api/discord/token` troca o
  código pelo token de acesso (precisa do segredo, por isso no servidor) → `authenticate` →
  `/api/discord/join` confere o token na API do Discord (e, num servidor, o acesso ao canal), acha ou cria
  a sala do canal (tabela `discord_channels`) e devolve a entrada na sala, com as permissões do canal e a
  foto no atributo `avatar` do participante. Os outros clientes só mostram a foto se ela vier de
  `cdn.discordapp.com/avatars/`: qualquer um edita os próprios atributos, e uma URL qualquer vazaria o IP
  de quem olha.
- **Transmissor** (`src/room/cast.ts`, `src/pages/CastPage.tsx`): a atividade pede um link em `/api/cast`
  provando quem é com o próprio token da sala. O servidor devolve `/transmitir#t=<token>`: um token
  LiveKit que **só publica tela e câmera**, vale 15 min pra abrir e leva o atributo `castFor` com a
  identidade de quem pediu (`&cam=1` no fragmento liga a câmera ao abrir). O token vai no fragmento (`#`),
  que o navegador não manda a servidor nenhum. Todos os clientes mostram as telas do transmissor sob o
  nome do dono, a câmera dele no quadro do dono, e deixam o transmissor fora dos tiles, da
  contagem de pessoas, dos sons de entrada/saída, de quem manda o histórico do chat e da herança do
  assistir junto. O "Parar" da atividade (e o desligar da câmera) vai pelo tópico `cast` do data channel
  e o transmissor só obedece ao dono. Se o dono some da sala por mais de 20 s, o transmissor encerra.
- **Tela cheia** (`src/room/fullscreen.ts`): usa a tela cheia do navegador quando a página pode e, quando
  não pode (o iframe do Discord), põe o elemento `fixed` por cima da página inteira.
- **Captura de tela bloqueada** (`screenCaptureBlocked`): dentro do Discord, sem `display-capture`
  liberado no iframe, o painel de tela vira o do transmissor em vez do seletor normal. Do mesmo jeito,
  sem `camera` (`cameraBlocked`), ou se o Discord negar a câmera na hora, o botão de câmera usa o
  transmissor.
- **YouTube**: a CSP que o Discord põe nas atividades só deixa `frame-src` no próprio proxy (e num player
  interno do Discord), e um URL mapping pro `youtube.com` não resolve: o proxy põe a mesma CSP na página
  do YouTube. No Discord, o `WatchPlayer` toca um `<video>` de `/api/youtube/<id>?t=<token da sala>`
  (`server/youtube.ts`), que só aceita token de quem entrou pela atividade (atributo `via: "discord"`,
  assinado no token; sem isso, qualquer um usaria o servidor como proxy do YouTube): o yt-dlp acha um MP4 com vídeo e som juntos (itag 18), o servidor repassa os bytes
  com Range e guarda o endereço até ele vencer. Um vídeo recusado fica recusado por 2 min, pra não chamar o
  YouTube a cada pedido de Range. O yt-dlp usa o deno da imagem pros desafios de JS do YouTube; a imagem
  pega o yt-dlp mais novo a cada build, então quando o YouTube quebrar algo, refaça o deploy.
  O transmissor toca o embed na própria página e captura a si mesmo (`startScreenShare` com `region`:
  `preferCurrentTab`, sem `restrictOwnAudio`, que tiraria o som do vídeo) recortado no player com
  `CropTarget`. O player fica sempre montado porque o alvo do recorte tem que existir quando o seletor
  abre; parar essa tela (de qualquer lugar) fecha o vídeo.

### Limites e problemas comuns

| Sintoma | O que é |
| --- | --- |
| O HypeMeet não aparece no 🚀 | Plataforma não marcada em **Activities → Settings**; Modo de desenvolvedor desligado; app não instalado no usuário/servidor; pessoa fora de **App Testers** |
| "A atividade do Discord não está configurada no servidor" | Faltam `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` no servidor |
| "O Discord não confirmou o login" | Segredo errado ou trocado no portal sem atualizar a variável |
| A atividade abre mas a sala não conecta | Mapping `/livekit` faltando ou errado, ou portas 7881/tcp e 7882/udp fechadas. A doc do Discord diz que **WebRTC não é suportado** nas atividades: a sinalização passa pelo proxy, mas áudio e vídeo vão direto ao LiveKit. No Discord desktop funciona; se algum cliente barrar, a tela de erro oferece **Abrir fora do Discord** |
| Abre uma página em branco / do Cloudflare | O mapping `/` aponta pra um túnel que não está mais no ar |
| "Esse link não vale mais" no transmissor | O link vale 15 min pra abrir: peça outro no botão de tela da atividade |
| Transmissão sem o som do PC | No navegador, Linux e macOS só mandam som de uma aba; o som do sistema precisa do app desktop |
| "O servidor não conseguiu trazer esse vídeo do YouTube" | Live, vídeo bloqueado fora do YouTube, ou o YouTube barrou o servidor (o log mostra o erro do yt-dlp; "Sign in to confirm you're not a bot" pede `YTDLP_COOKIES`). Use **Transmitir pelo navegador** |
| O plugin não aparece no botão de plugins da atividade | Falta o mapping `/plugins/<id>` (acima do `/`), ou o plugin não está na raiz do domínio dele |
| A sala não conecta e o console fala de `RTCPeerConnection` | O proxy do Discord injeta `RTCPeerConnection = null` nas páginas das atividades (visto em 28/10/2026). Sem WebRTC não há LiveKit (nem o data channel que o Drawspace usa). Use **Abrir fora do Discord** |

## Servidores do Discord no site

**Entrar com o Discord** (embaixo da barra lateral) é opcional: sem conta, tudo segue com apelido. Entrando,
a barra da esquerda mostra seus servidores do Discord abaixo do **H**, que leva aos **Grupos** (as salas
criadas aqui por código):

- **Canais de voz**: num servidor com o bot do HypeMeet, a barra lista os canais de voz que você vê no
  Discord, na ordem e nas categorias de lá. Embaixo de cada um, primeiro quem está na call do Discord (com
  o microfone desligado / ensurdecido e um **H** em quem também está na sala do HypeMeet), depois quem só
  está na sala. Canal em que você não pode conectar aparece com cadeado. A lista se atualiza a cada 15 s.
- **Uma sala por canal**: a mesma que a [atividade](#atividade-do-discord) abre naquele canal, então quem
  está no site, no app e no Discord se encontra. Entrar pede login com o Discord e **Ver canal** +
  **Conectar** no canal; você entra com o nome e a foto do Discord.
- **Permissões do canal na sala** (tabela abaixo), lidas pelo bot dos cargos e das permissões do canal.
- **Moderação**: o número de pessoas no topo da sala abre a lista de quem está lá. Quem tem a permissão no
  canal silencia / permite falar, ensurdece / tira o ensurdecimento e desconecta. Vale na sala e, se a
  pessoa estiver na call daquele canal do Discord, lá também (pelo bot, com "HypeMeet: <quem moderou>" no
  registro de auditoria).
- **Convidar**: no site, copia o link da sala ou, com **Criar convite**, um convite `discord.gg` que abre a
  atividade do HypeMeet no canal. Na atividade, o convite do próprio Discord ou o link do site.
- **Servidor sem o bot**: aparece apagado, com "O HypeMeet ainda não está em …" e **Adicionar ao servidor**
  pra quem é dono ou tem **Administrador** ou **Gerenciar servidor**.

### Configurar

1. No portal, os **Redirects** do login (passo 1 de [Configurar o app no Discord](#configurar-o-app-no-discord))
   e o **Bot** (passo 5).
2. No servidor, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` e `PUBLIC_URL` (veja
   [Variáveis no servidor](#variáveis-no-servidor)).
3. Adicione o bot a cada servidor pelo botão do site, que abre este link com o servidor já escolhido:

   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot&permissions=30409729&guild_id=<ID do servidor>&disable_guild_select=true`

   `30409729` = **Ver canais**, **Conectar**, **Criar convite**, **Silenciar membros**, **Ensurdecer
   membros** e **Mover membros**. O bot não lê nem manda mensagens e não entra na call: consulta o
   servidor pela API, acompanha as calls pelo Gateway (abaixo) e aplica a moderação.

### Gateway

Com `DISCORD_BOT_TOKEN`, o servidor do HypeMeet mantém uma conexão com o Gateway do Discord em nome do bot
(`server/gateway.ts`), com as intents **GUILDS** e **GUILD_VOICE_STATES**, nenhuma privilegiada. É dela que
vem quem está na call de cada canal na barra, o estado de voz que a moderação e a entrada pela atividade
consultam (sem ela, ou num servidor que ela ainda não carregou, o servidor pergunta pela API) e o aviso de
que canais, cargos ou a lista de servidores do bot mudaram (o cache deles cai na hora). Mudança de cargo de
um membro pediria a intent privilegiada **GUILD_MEMBERS**: essa segue esperando o cache de 30 s.

É uma conexão por servidor do HypeMeet rodando, dev incluído (rodar o mesmo token em dois lugares abre
duas). Cada reinício é um *Identify* novo, e o Discord limita a 1000 por dia por bot: passou disso, ele
**reseta o token do bot** e derruba todas as conexões, produção incluída. Como o `bun run dev` reinicia a
API a cada arquivo salvo, **não use o token de produção no dev**: deixe `DISCORD_BOT_TOKEN` fora do `.env`
local ou crie um app/bot separado só pra desenvolver.

### Permissões

| No canal do Discord | Na sala |
| --- | --- |
| **Ver canal** | O canal aparece na lista |
| **Ver canal** + **Conectar** | Entrar na sala |
| **Falar** | Ligar o microfone |
| **Vídeo** | Câmera e tela (inclusive pelo transmissor) |
| **Silenciar membros** | Silenciar no servidor / Permitir falar |
| **Ensurdecer membros** | Ensurdecer / Tirar ensurdecimento |
| **Mover membros** | Desconectar |
| **Criar convite** | Copiar convite do Discord |

Dono do servidor e **Administrador** podem tudo. Quem está de castigo (timeout) só vê o canal, então não
entra. O cálculo é o do Discord (`server/permissions.ts`): `@everyone` + cargos, depois as permissões do
canal pra `@everyone`, pros cargos e pro membro.

### Limites

- **As permissões são lidas quando você entra**: mudou um cargo ou o canal no Discord, vale quando a pessoa
  entrar de novo na sala. A moderação confere quem modera na hora (com até 1 min de cache: cargos do servidor ficam 60 s, canal e membro 30 s; com o [Gateway](#gateway) no ar, mudança de canal ou de cargo derruba o cache na hora e só a de cargo de um membro espera os 30 s).
- **Canais privados**: a partir de 16/11/2026 o Discord só lista pro bot os canais que ele vê, então um
  canal privado só aparece se o bot (ou um cargo dele) tiver **Ver canal** nele.
- **Silenciar e ensurdecer no servidor valem no Discord inteiro**, em qualquer canal de voz daquele
  servidor, até alguém desfazer (pelo HypeMeet ou pelo próprio Discord).
- **Servidor sem o bot**: a atividade só confere se você é membro do servidor, mas sem o bot não dá pra
  provar que o canal é mesmo de lá. Por isso a sala desse canal fica como uma sala comum: quem tem o código
  entra pelo site com apelido, todo mundo fala e transmite e não há moderação. Quando o bot entra no
  servidor, o canal ganha uma **sala nova** (código novo), fechada pelo Discord; a antiga continua
  existindo como sala comum, então quem estava numa call nela fica lá até sair.
- **Silenciado continua silenciado**: quem foi silenciado pelo HypeMeet entra de novo ainda sem microfone
  (fica guardado no banco), e quem está com silenciar no servidor do Discord também.

### Problemas comuns

| Sintoma | O que é |
| --- | --- |
| "Invalid OAuth2 redirect_uri" no Discord | O callback não está nos **Redirects** do portal, ou não bate com `PUBLIC_URL` (`http`/`https`, porta) |
| Um servidor aparece com "O HypeMeet ainda não está em …" | O bot não foi adicionado a ele; se forem todos, falta `DISCORD_BOT_TOKEN` no servidor |
| "Você não tem acesso a este canal no Discord" | Falta **Ver canal** ou **Conectar** pra você naquele canal |
| A moderação vale na sala mas dá erro sobre uma permissão do bot | O bot não tem **Silenciar**, **Ensurdecer** ou **Mover membros** naquele canal (as permissões do canal podem tirar) |
| "O Discord não criou o convite" | O bot precisa de **Criar convite** no canal |

## App desktop (Windows / macOS / Linux)

`desktop/` empacota o HypeMeet em Electron: o app abre o front do **seu servidor** (o mesmo de
produção ou do `dev:lan`) numa janela própria e adiciona o que a aba do navegador não tem:

- **Seletor de tela nativo** (telas e janelas com miniatura), uma vez por tela compartilhada.
- **Áudio do sistema** junto da tela. No Windows e no macOS (14.2+) o som da própria chamada fica de
  fora.
- **Áudio de um app ou de uma aba só** no Linux (PipeWire): o campo "Áudio" do seletor lista o que
  está tocando — cada app e, nos navegadores derivados do Firefox (Firefox, Zen, LibreWolf…), cada
  aba pelo título; no Chrome/Chromium as abas não se distinguem, então é o navegador inteiro.
  Escolhendo uma janela, o app já pré-seleciona a aba/app dela. "Todo o som do PC" também deixa a
  chamada de fora. Usa o [`@vencord/venmic`](https://github.com/Vencord/venmic) (o mesmo do
  Vesktop): ele cria um microfone virtual (`vencord-screen-share`) ligado só aos streams escolhidos,
  e a página grava esse microfone como o áudio da tela. Um microfone só, então uma tela por vez com
  áudio. Sem PipeWire, volta ao áudio do sistema inteiro (com eco). No Wayland o seletor de tela é o
  do sistema (portal), que não pergunta de áudio: o app pergunta logo depois.
- **Pressione para falar** com o jogo em foco: no menu do microfone (setinha ao lado do botão), liga e
  escolhe uma tecla ou botão do mouse (meio ou laterais). Segurar abre o microfone, soltar fecha; com
  o microfone já aberto a tecla não faz nada. A tecla continua chegando ao jogo. Usa
  [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi), que só fica ativo com a opção ligada e uma
  sala aberta (o `globalShortcut` do Electron não avisa quando a tecla é solta). No Linux depende do
  X11: no Wayland só pega as teclas com uma janela X11/XWayland em foco (a maioria dos jogos, Steam
  e Proton). No macOS pede a permissão de Acessibilidade.
- **Entrar com o Discord** abre o login do Discord numa janela do app, sem acesso às funções do app; no
  fim ela fecha, a página volta com você logado e a sessão fica salva no app. Fechar a janela cancela.
- Segue rodando minimizado (sem throttling) e abre links externos no navegador.

```bash
bun run desktop                                        # roda local; pede o servidor na 1ª vez
bun run desktop:build --url https://meet.seudominio.com            # pacote do sistema atual
bun run desktop:build --url https://meet.seudominio.com --linux --win --mac
bun run desktop:publish                                # sobe os builds como GitHub Release
```

Saída em `desktop/release/`: `HypeMeet-Setup-<versão>.exe` (instalador), `HypeMeet-<versão>-portable.exe`,
`HypeMeet-<versão>-x86_64.AppImage`, `HypeMeet-<versão>-amd64.deb`, `HypeMeet-<versão>-x64.tar.gz` e
`HypeMeet-<versão>-mac-{arm64,x64}.zip`. Gerar o `.exe` fora do Windows usa Docker
(`electronuserland/builder:wine`); o pacote Linux precisa ser gerado no Linux. O macOS sai de qualquer
sistema, mas precisa de [`rcodesign`](https://github.com/indygreg/apple-platform-rs/releases) e `zip`
no PATH: sem conta de desenvolvedor Apple, o `.app` leva assinatura ad-hoc (o mínimo para abrir no
Apple Silicon), então na primeira vez o macOS pede **Ajustes → Privacidade e Segurança → Abrir Mesmo
Assim**, e compartilhar tela pede a permissão de Gravação de Tela.

**Downloads no site.** `desktop:publish` cria a release `v<versão>` (de `desktop/package.json`) no repo
público [`hypemeet-releases`](https://github.com/victorgabrieldeon/hypemeet-releases) — este repo é
privado — com os arquivos sem a versão no nome (`HypeMeet-Setup.exe`, `HypeMeet-mac-arm64.zip`…).
A página `/baixar` (botão "Baixar app" da home) linka `releases/latest/download/<arquivo>`, então publicar uma versão nova já atualiza o site.
A lista de arquivos vive em `src/lib/downloads.ts` e vale para o site e para o script. Para lançar
uma versão nova, suba `version` em `desktop/package.json`; rodar de novo na mesma versão substitui
os arquivos.

**Atualização dentro do app.** O app checa a release mais recente ao abrir e a cada 4 h (ou em
**HypeMeet → Verificar atualizações…**). Instalador do Windows, AppImage e `.deb` baixam a versão nova
em segundo plano e mostram **Atualizar** no topo da tela inicial: um clique reinicia já atualizado (no
`.deb` o sistema pede a senha). Sem o clique, ela é instalada ao fechar o app (menos no `.deb`). macOS
(assinatura ad-hoc não deixa trocar o app sozinho), `.exe` portátil e `.tar.gz` mostram **Baixar
atualização**, que abre o arquivo novo no navegador. O feed são os `latest.yml`/`latest-linux.yml` que o
`desktop:build` gera e o `desktop:publish` sobe junto, então publique sempre Windows e Linux juntos.
Versões anteriores à 0.2.0 não têm o atualizador: quem estiver nelas precisa baixar uma vez pelo site.

Servidor usado, em ordem: `--server=<url>` na linha de comando → `HYPEMEET_URL` → o salvo pelo app →
o `--url` do build. Sem nenhum, o app pede o endereço; depois dá pra trocar em **HypeMeet → Trocar
servidor…** (Alt mostra o menu). Servidor com certificado autoassinado (`dev:lan`): o app mostra a
impressão digital e oferece **Confiar neste certificado**, fixado só para aquele host.

## Como o assistir junto funciona

Nenhum vídeo passa pelo LiveKit: só o estado da reprodução (`src/room/watch.ts`).

- **Estado** no atributo `watch` de quem começou (o host): fonte, tocando/pausado, posição e o
  horário em que ela foi medida, no relógio do host. Quem entra depois lê o atributo e já cai no ponto certo.
- **Controles** de qualquer pessoa viram uma RPC (`watch.action`) pro host, que aplica e republica.
  Por isso o token dá `canUpdateOwnMetadata`.
- **Relógio**: cada um mede a diferença pro relógio do host com algumas RPCs `watch.clock` (fica a
  de menor ida e volta). O player de cada um, inclusive o do host, segue o estado: dá play/pause
  pra bater e faz seek se desviar mais que 1 s (YouTube), 3 s (live) ou 0,4 s (arquivo). Um seek
  que não pega (borda da live fora de alcance, anúncio) desiste depois de 3 tentativas em 20 s.
- **Host saiu**: quem está há mais tempo na sala assume o último estado, então a sessão continua.
  Quem parou de acompanhar continua podendo herdar: o estado não depende de ter o player aberto.
- **Vídeo do computador**: cada pessoa abre a própria cópia (o app pede pelo nome e tamanho); nada é
  enviado. Começa pausado pra dar tempo de todo mundo abrir o arquivo. Formatos: o que o navegador
  tocar (MP4 H.264/AAC e WebM em todo lugar; MKV depende do codec).
- **YouTube**: IFrame Player API com o player nativo. Play, pause, seek (barra ou teclado) e
  velocidade feitos nele viram ações pra todos: play/pause pelos eventos de estado, seek por um salto
  de mais de 2 s entre duas leituras, velocidade pelo evento de taxa; comandos da própria sincronia
  são ignorados por 1,5 s pra não voltarem como ação. Título e "é live" vêm do player de quem estiver
  assistindo (sem chave de API; o host pode não estar acompanhando). Vídeos com incorporação desativada pelo dono não tocam.
- **Lives**: `getCurrentTime()` numa live é o tempo desde o início da transmissão, igual pra todo
  mundo. O player do host abre na borda ao vivo e publica essa posição; até lá ninguém faz seek.
  Pausar e retomar continua do ponto pausado (se a live tiver DVR), todos juntos.

## Como as várias telas funcionam

Cada tela vira um par de trilhas publicadas no LiveKit:

- vídeo `screen:<timestamp>-<id>` (source `ScreenShare`)
- áudio `screen:<timestamp>-<id>:audio` (source `ScreenShareAudio`, Opus estéreo sem processamento de voz)

Quem assiste junta vídeo + áudio pelo nome e ordena pelo timestamp. Quando a tela para (central de
transmissões, botão "Parar" do tile ou a barra "Parar compartilhamento" do navegador), o áudio
pareado é despublicado junto. "Mudo" na central só pausa o áudio daquela tela (a trilha continua
publicada); uma tela compartilhada sem som não ganha som depois — é preciso abrir uma nova.

A sala conecta com `autoSubscribe: false`: microfones e câmeras são assinados automaticamente
(`useSubscriptions`), telas só quando quem assiste clica em "Ver transmissão" — o áudio pareado
segue a escolha feita para o vídeo, inclusive se for publicado depois.

As prévias (`previews.tsx`) não usam o vídeo: quem transmite desenha um frame da captura num canvas
(480 px, WebP/JPEG ~20 KB) a cada 10 s e manda como byte stream no tópico `screen-preview`; só o
dono da tela pode trocar a prévia dela, e ela some quando a tela é despublicada.

O volume acima de 100% usa `webAudioMix` do LiveKit (GainNode por trilha).

### Qualidade da conexão

As barrinhas ao lado de cada nome são a `connectionQuality` que o servidor LiveKit calcula pra cada
pessoa (3 = excelente, 2 = boa, 1 âmbar = ruim, vermelho = caiu). Passando o mouse numa tela aparece
o que está realmente indo/chegando, medido via `getStats()` a cada segundo: resolução e fps da maior
camada ativa e o bitrate somado. Quem compartilha vê "Ninguém assistindo · envio pausado" quando o
dynacast desliga todas as camadas.

## Limitações de áudio da tela (do navegador, não do app)

- **Chrome/Edge no Windows/ChromeOS**: áudio da aba ou do sistema inteiro.
- **Chrome/Edge 141+ no Windows**: ao escolher uma **janela**, o seletor oferece o áudio só daquele
  app (`windowAudio: "window"`).
- **Chrome/Edge no Linux/macOS**: só áudio de **aba** (compartilhe uma aba e marque "Compartilhar áudio").
- **Firefox/Safari**: sem áudio de tela.

Se a tela for compartilhada sem som, o app avisa.

### Áudio do sistema sem o Discord

O navegador não deixa excluir um app específico do áudio do sistema: "tela inteira + áudio do
sistema" pega tudo que toca no dispositivo de saída padrão, Discord incluso. O que dá pra fazer:

- **Som da própria sala nunca volta**: a captura pede `restrictOwnAudio`, então o Chrome 141+
  tira do áudio do sistema o que a aba do HypeMeet está tocando (voz e telas dos outros).
- **Só o áudio do jogo/app**: compartilhe a **janela** dele (não a tela inteira) e marque o áudio
  da janela — o Discord fica de fora.
