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
  fora; no Linux não dá pra excluir, então vem desligado e o seletor avisa do eco. No Wayland o
  seletor é o do sistema (portal do PipeWire), que não pergunta de áudio: o app pergunta logo depois.
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

Servidor usado, em ordem: `--server=<url>` na linha de comando → `HYPEMEET_URL` → o salvo pelo app →
o `--url` do build. Sem nenhum, o app pede o endereço; depois dá pra trocar em **HypeMeet → Trocar
servidor…** (Alt mostra o menu). Servidor com certificado autoassinado (`dev:lan`): o app mostra a
impressão digital e oferece **Confiar neste certificado**, fixado só para aquele host.

## Como as várias telas funcionam

Cada tela vira um par de trilhas publicadas no LiveKit:

- vídeo `screen:<timestamp>-<id>` (source `ScreenShare`)
- áudio `screen:<timestamp>-<id>:audio` (source `ScreenShareAudio`, Opus estéreo sem processamento de voz)

Quem assiste junta vídeo + áudio pelo nome e ordena pelo timestamp. Quando a tela para (central de
transmissões, botão "Parar" do tile ou a barra "Parar compartilhamento" do navegador), o áudio
pareado é despublicado junto. "Mudo" na central só pausa o áudio daquela tela (a trilha continua
publicada); uma tela compartilhada sem som não ganha som depois — é preciso abrir uma nova.

O volume acima de 100% usa `webAudioMix` do LiveKit (GainNode por trilha).

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
