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
- **Mesa** (botão de dados na barra), pra quem joga cassino ao vivo: quem transmite abre a mesa com a
  banca inicial (meta e limite opcionais) e vai digitando o saldo (`1.250`, `+150`, `-80`). Nada vale
  dinheiro: é só um número que a sala acompanha. A partir daí:
  - **Placar** no canto da tela (saldo, ▲/▼ na noite, gráfico e sequência) e **narrador** que comenta
    cada mudança ("VIRADA HISTÓRICA", "o saldo está em queda livre"…).
  - **Cadeira da sorte** 🍀 pra quem assistia na última vitória (e "Fulano levou a sorte embora" se a
    pessoa sai e vêm duas perdas), **pé-frio da noite** 🧊 pra quem assistiu à pior sequência de perdas
    até a próxima vitória, e um **amuleto** que passa pra outra pessoa a cada vitória. Os selos aparecem
    ao lado do nome.
  - **Ritual** 🙏: 5 s pra galera clicar antes do bônus; o tile mostra quantos rezaram.
  - **Modo novela**: três perdas seguidas deixam a tela em preto e branco com música triste pra quem
    assiste; a cor volta de uma vez na vitória.
  - **Vai pagar…** ⏳: qualquer um aperta, a tela dá um zoom lento com rufar de tambor até alguém marcar
    "Pagou!"/"Não pagou" (ou o saldo mudar).
  - **Placa de luto** "🕯️ Aqui jazia R$ 300" nas perdas grandes e **luzes de boate** em todos os tiles
    nas vitórias grandes.
  - **Apostas de zoeira**: alguém propõe ("paga mais de 100x?"), cada um escolhe sim/não e quem errar
    vira 🤡/🐔/🥔… no avatar por 1 hora (o app aplica e desfaz sozinho).
  - **Comentário fixado** 📌 por cima da tela por 10 s (um a cada 2 min por pessoa), **"Para!"** 🛑 e o
    placar do **"eu avisei"**: se veio perda até 2 min depois de alguém mandar parar, a sala vota se vale
    ponto.
  - **Tomate e flor** 🍅🌹: clique pra jogar ou arraste até a tela; voa, bate e faz barulho.
  - **Termômetro de nervoso** na câmera de quem joga: a borda esquenta com as reações da sala.
  - **Trilha de cassino** que quem transmite liga pra sala toda e acelera com o hype, e **alerta de
    hora de parar**: bater a meta ou o limite toca uma sirene e a galera vota se sai ou continua.

  As ações rápidas ficam no 🎰 da barra do tile (ao passar o mouse) e no painel da Mesa, que também tem
  o volume dos efeitos e da música, só seus. Tudo vai pelo data channel do LiveKit (tópico `casino`): o
  cliente de quem abriu a mesa é a autoridade e republica o estado a cada mudança; quem entra depois pede
  o estado ao chegar. Recarregar a página mantém a mesa (sessionStorage da aba).
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
