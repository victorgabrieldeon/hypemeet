# HypeMeet

Salas para transmitir tela(s) e câmera com áudio. Dark, sem conta: apelido + código da sala.

- **Criar sala** com nome → gera código `ABC-DEF` pra mandar pra galera.
- **Salas salvas**: toda sala que você cria/entra aparece no topo da home (localStorage do navegador).
- **Várias telas ao mesmo tempo** por pessoa, cada uma com seu próprio áudio.
- **Volume por stream, só pra você**: mutar ou ajustar de 0–200% cada tela e cada microfone.
- **Central de transmissões** (botão de tela na barra): lista cada tela que você está mandando, com
  **Parar** (uma ou todas), **modo** e **som** ajustáveis ao vivo, e prepara a próxima tela
  (modo + "Transmitir com som") antes de abrir o seletor. As escolhas da próxima tela ficam salvas.
- **Modo por tela**: "Jogo" (60 fps, 6 Mbps, prioriza fluidez) ou "Nitidez" (30 fps, 4 Mbps,
  prioriza resolução). Trocar numa tela já no ar ajusta captura, encoder e bitrate sem reabrir o seletor.
- **Escolher microfone, câmera e saída de áudio** nos chevrons dos botões; a escolha fica salva.
- Fixar (duplo clique) e tela cheia por tile.
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
| API | Bun (`server/index.ts`) + SQLite (`bun:sqlite`) — salas e tokens |

A API só guarda `código → nome` e emite tokens LiveKit; vídeo/áudio vão direto browser ⇄ LiveKit.

## Rodando local

Requisitos: Bun ≥ 1.2, Docker.

```bash
bun install
bun run livekit   # sobe livekit-server em modo dev (devkey/secret) na 7880
bun run dev       # API na 3001 + Vite na 5173
```

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
PORT=3001 bun run start      # serve a API e o front buildado (dist/); recusa subir sem as 3 variáveis
```

| Variável | Padrão | |
| --- | --- | --- |
| `LIVEKIT_URL` | dev: mesma origem via proxy `/rtc` | URL **pública** que o navegador usa (`wss://`). Obrigatória em produção |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | dev: `devkey` / `secret` | Mesmas chaves do servidor LiveKit. Obrigatórias em produção |
| `LIVEKIT_HOST` | `LIVEKIT_URL` (dev: `http://localhost:7880`) | URL que o servidor usa para consultar a API do LiveKit (quem está online). Em produção dá para apontar direto para a rede interna, ex. `http://livekit:7880` |
| `PORT` | `3001` | |
| `DB_PATH` | `data/hypemeet.db` | Arquivo SQLite das salas |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | — | Liga a [atividade do Discord](#atividade-do-discord). Sem elas, `/api/discord/*` responde 503 |
| `PLUGINS` | — | Endereços dos [plugins](#plugins) que as salas podem abrir, separados por vírgula (ex. `https://draw.exemplo.com`) |
| `PUBLIC_URL` | origem do pedido | Endereço do site (ex. `https://meet.exemplo.com`), usado nos links que saem da atividade do Discord (transmissor, "Abrir fora do Discord", convite) |

O `docker-compose.yml` usa `--dev` — **não** use em produção. Para produção rode o LiveKit com
config própria (chaves fortes, TLS, portas UDP liberadas) ou use LiveKit Cloud.
Guia: https://docs.livekit.io/home/self-hosting/deployment/

### Dokploy (`docker-compose.prod.yml`)

Exemplo de deploy (projeto `hypemeet` no Dokploy, compose ligado ao repo
GitHub, branch `main`). O stack sobe o app (`Dockerfile`, SQLite no volume `hypemeet-data`) e um
LiveKit próprio:

| Serviço | Domínio (HTTPS pelo Traefik) | Portas no host |
| --- | --- | --- |
| `app` | `meet.exemplo.com` → 3001 | — |
| `livekit` | `livekit.exemplo.com` → 7880 (sinalização `wss://`) | 7881/tcp e 7882/udp (mídia) |

Variáveis do compose no Dokploy: `LIVEKIT_DOMAIN`, `LIVEKIT_NODE_IP` (IP público do servidor),
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (≥ 32 caracteres). As portas 7881/tcp e 7882/udp precisam
estar abertas no firewall do servidor; sem elas a sala abre mas vídeo/áudio não chegam.

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

Quem está com cada plugin aberto vai no atributo `plugins` do participante, então o tile aparece pra todo
mundo enquanto alguém usa e não há nada pra passar adiante quando alguém sai. O estado do plugin é
problema dele (o Drawspace, por exemplo, pede o quadro pra quem está há mais tempo). Plugins não aparecem
na atividade do Discord, que só carrega domínios mapeados.

## Atividade do Discord

O HypeMeet também roda **dentro do Discord** como atividade (o 🚀 do canal de voz):

- **Entra direto**, sem lobby, com o nome e a foto do Discord. A foto aparece também pra quem está no
  site ou no app.
- **Uma sala por canal de voz**: todo mundo do canal cai na mesma sala, criada na primeira vez que alguém
  abre a atividade ali. É uma sala normal, com código, então dá pra entrar também pelo site ou pelo app
  desktop.
- **Convidar** abre o convite do próprio Discord; **Sair** fecha a atividade.
- **Transmitir tela**: o Discord não deixa a atividade capturar a tela, então o botão de tela abre um
  **transmissor no navegador**. Você escolhe a tela lá e ela aparece na sala como sua, com o mesmo nome.
  O painel de tela da atividade lista o que está no ar e tem **Parar** / **Parar todas**. Deixe a aba
  do navegador aberta (pode minimizar); sair da atividade para a transmissão depois de 20 s.
- **Câmera**: o Discord também não libera a câmera pra atividades, então o botão de câmera abre o mesmo
  transmissor, que já liga a câmera (a escolhida da última vez nesse navegador). Ela aparece no seu quadro
  da sala; o botão da atividade desliga.
- **YouTube**: o Discord barra o player do YouTube dentro de atividades (só o Watch Together dele pode).
  No **Assistir junto** da atividade, **Transmitir YouTube pelo navegador** abre o transmissor: cole o
  link em **Vídeo do YouTube**, escolha **esta aba** no seletor com o áudio ligado, e o vídeo toca ali e
  entra na sala como sua tela, com som. Play, pausa e volume ficam no player do transmissor. No Chrome/Edge
  só o player vai (Region Capture); no Firefox vai a janela inteira, sem som. Se alguém de fora
  começar um YouTube no assistir junto, quem está no Discord vê o tile mas não acompanha. Vídeo do
  computador funciona normal.
- **Tela cheia**: o iframe do Discord não libera a tela cheia do navegador, então lá o botão "Tela cheia"
  do tile faz a tela ocupar a atividade inteira (Esc sai). Junto com a tela cheia do próprio Discord
  (canto inferior direito da chamada, ou ↗ pra abrir em janela), cobre a tela toda.
- **Sem microfone**: a voz é a do canal do Discord, então a atividade não tem botão de microfone nem
  soundboard (que sai pelo microfone), e os quadros não mostram o ícone de mic desligado.

### Configurar o app no Discord

Tudo em https://discord.com/developers/applications → seu app:

1. **OAuth2**: copie o *Client ID* e o *Client Secret* (vão nas variáveis abaixo). Em **Redirects**
   adicione `https://127.0.0.1`: o Discord exige um redirect cadastrado, mesmo sem usar.
2. **Activities → Settings**: ative as atividades e marque as plataformas (Desktop, Web, Mobile). A
   atividade só aparece nas plataformas marcadas.
3. **Activities → URL Mappings**. A ordem importa: o mais específico em cima.

   | Prefixo | Destino |
   | --- | --- |
   | `/livekit` | `livekit.exemplo.com` |
   | `/` | `meet.exemplo.com` |

   O destino vai **sem** `https://`. O `/` é o site; o `/livekit` é a sinalização do LiveKit.
4. **Installation**:
   - **Installation Contexts**: marque **User Install** (usar em qualquer lugar) e/ou **Guild Install**
     (adicionar a servidores).
   - **Install Link**: *Discord Provided Link*.
   - **Default Install Settings**: só o escopo `applications.commands`. Não precisa de `bot` nem de
     permissões (com `bot`, a tela de instalação passa a pedir coisas como "Enviar mensagens").
5. Opcional: ícone e descrição em **General Information** e a capa da atividade em **Activities → Art
   Assets** (é o que aparece na lista do 🚀).

### Variáveis no servidor

| Variável | |
| --- | --- |
| `DISCORD_CLIENT_ID` | *Client ID* do app |
| `DISCORD_CLIENT_SECRET` | *Client Secret* do app. Nunca vai pro git: local fica no `.env` (ignorado), em produção nas variáveis do Dokploy |
| `PUBLIC_URL` | Endereço do site, ex. `https://meet.exemplo.com`. Usado nos links que saem da atividade (transmissor, "Abrir fora do Discord", convite copiado): lá dentro o pedido chega pelo proxy do Discord, então o servidor não sabe o próprio endereço |

No Dokploy elas já estão no `docker-compose.prod.yml`; é só preencher e fazer redeploy. Sem as duas
primeiras, `/api/discord/*` responde 503 ("A atividade do Discord não está configurada no servidor").
Se o segredo vazar, gere outro em **OAuth2 → Reset Secret** e troque a variável.

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
tentar ler o nome do canal. Pedidos como "enviar mensagens" não vêm do HypeMeet: vêm da configuração de
instalação (veja o passo 4 acima). Pra ver a tela de permissões de novo depois de mudar algo:
Configurações → **Aplicativos autorizados** → HypeMeet → **Desautorizar**, e abra a atividade outra vez.

### Testar local

1. Crie o `.env` com `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET` (ignorado pelo git).
2. `bun run livekit` e `bun run dev`.
3. Abra um túnel até o Vite: `cloudflared tunnel --url http://localhost:5173`. Ele imprime um endereço
   `https://<algo>.trycloudflare.com` (o Vite aceita esses hosts: `allowedHosts` no `vite.config.ts`).
4. Ponha esse endereço no `.env` como `PUBLIC_URL` (pro link do transmissor abrir no túnel) e reinicie
   o `bun run dev`.
5. No portal, troque o mapping `/` pelo endereço do túnel, sem `https://`. O `/livekit` não é usado no
   dev: o Vite já repassa `/rtc` pro LiveKit local.
6. Abra a atividade no Discord. Mudanças no front chegam com o recarregar da atividade.

O endereço do túnel muda toda vez que ele reinicia. Ao terminar, volte o mapping `/` pra produção:
enquanto ele apontar pro túnel, a atividade só abre com a sua máquina ligada.

### Como funciona por dentro

- **Detecção** (`src/lib/discord.ts`): o Discord serve a página em `https://<client id>.discordsays.com`
  com `frame_id` na URL. Nesse caso o `main.tsx` mostra a atividade (`src/pages/DiscordActivity.tsx`)
  no lugar das rotas, e só aí carrega o [Embedded App SDK](https://github.com/discord/embedded-app-sdk).
- **Proxy**: todo o tráfego da atividade passa pelo proxy do Discord, que só leva HTTP e WebSocket. O
  `/api` funciona como está (mapping `/`); a URL do LiveKit é trocada por
  `wss://<client id>.discordsays.com/livekit` (mapping `/livekit`).
- **Login**: `sdk.ready()` → `authorize` (consentimento só na primeira vez) → `/api/discord/token` troca o
  código pelo token de acesso (precisa do segredo, por isso no servidor) → `authenticate` →
  `/api/discord/join` confere o token na API do Discord, acha ou cria a sala do canal (tabela
  `discord_channels`) e devolve a entrada na sala, com a foto no atributo `avatar` do participante. Os
  outros clientes só mostram a foto se ela vier de `cdn.discordapp.com/avatars/`: qualquer um edita os
  próprios atributos, e uma URL qualquer vazaria o IP de quem olha.
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
- **YouTube**: a CSP que o Discord põe nas atividades não tem `www.youtube.com` em `script-src` nem em
  `frame-src` (só a do Watch Together tem), e um URL mapping não resolve: o player busca
  `googlevideo.com` por fora do proxy. Por isso a atividade nem monta o player de uma sessão de YouTube.
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

**Ainda não funciona dentro da atividade**: o assistir junto do **YouTube**. O player é do
`youtube.com`, bloqueado pela política de segurança das atividades; o vídeo do computador funciona.

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
