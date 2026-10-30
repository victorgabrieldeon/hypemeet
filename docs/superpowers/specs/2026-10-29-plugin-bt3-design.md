# Plugin Budokai Tenkaichi 3 — design

Data: 2026-10-29. Branch: `feat/plugin-bt3`.

## Objetivo

Jogar Dragon Ball Z: Budokai Tenkaichi 3 com os amigos dentro de uma sala do HypeMeet, no navegador, no app
desktop e na atividade do Discord. O jogo é o port web do projeto
[Tenkaichi3Decomp](https://github.com/stufno102/Tenkaichi3Decomp) (fork do stufno102, commit
`81507cde58685a6f5aab917c298d9a9f82fe09b0`), compilado a partir da ISO do dono do servidor.

O jogo entra como um plugin **embutido** no HypeMeet: aparece no painel de Plugins como o Drawspace, sem
subdomínio, sem a variável `PLUGINS` e sem URL mapping novo no Discord.

## Premissas e limites

- O servidor é privado: só o dono e amigos que têm cada um a própria ISO jogam. O README do plugin diz isso.
- A ISO e tudo que é gerado dela (dados extraídos, disassembly, o jogo compilado) ficam só no volume do
  servidor. Nunca no git, nunca numa imagem Docker publicada.
- A v1 usa uma ISO no servidor (a do dono), enviada uma vez pelo próprio plugin. Cada amigo escolher a
  própria ISO no navegador fica para o commit seguinte (a página do jogo já tem esse modo, `?pick=1`).
- Só a versão americana é aceita (SLUS-21678), como no projeto original.

## Como fica para quem usa

1. Alguém abre **Budokai Tenkaichi 3** no painel de Plugins da sala.
2. **Primeira vez no servidor:** o plugin pede a ISO ("Enviar a ISO do jogo", uma vez para todo mundo).
   O envio vai em pedaços e retoma se cair. Depois o servidor confere a ISO e compila o jogo sozinho; o
   plugin mostra o passo atual ("Conferindo a ISO", "Extraindo os dados", "Compilando o jogo"…). Quem abrir
   o plugin nesse meio-tempo vê o mesmo progresso.
3. **Depois disso:** abrir o plugin carrega o jogo direto, já com tudo desbloqueado (padrão do port web).
4. **Online:** no menu principal, "Dragon Net Battle". Criar sala gera um código de 4 letras; o amigo
   escolhe Entrar e digita o código. Também há Quick Match. **Local:** os modos normais do jogo (contra a
   CPU, ou dois jogadores no mesmo PC).
5. **Teclado e mouse:** clicar no jogo dá foco a ele; as teclas vão para o jogo, e os atalhos do HypeMeet
   (push-to-talk, por exemplo) não disparam enquanto o foco está nele. O mouse funciona nos menus da página
   (envio da ISO, salas do online) e nas configurações do jogo (F1). Controle funciona onde o navegador
   deixar (no Discord, depende de ele liberar para atividades).
6. Quando ninguém mais está com o plugin aberto, o tile some (comportamento atual dos plugins). O jogo
   roda no navegador de cada um; no servidor, parado, só fica um processo ocioso.

Saves e configurações do jogo não ficam guardados (o plugin roda numa origem opaca, ver Segurança). Como
tudo já vem desbloqueado, isso só afeta mudanças de configuração, que voltam ao padrão a cada sessão.

## Arquitetura

```
navegador (sala)                         servidor (Dokploy, docker-compose.prod.yml)
┌──────────────────────────┐             ┌───────────────────────────────────────────┐
│ HypeMeet (RoomView)      │  /api/...   │ app (Bun, server/index.ts)                │
│  PluginView ─ iframe ────┼────────────►│  server/bt3/*: passe, página, jogo,       │
│  (origem opaca)          │ /plugins/   │  disco em pedaços, upload, status, salas  │
│   página do plugin       │  bt3/p/...  │                │ volume hypemeet-data     │
│   └► jogo (wasm)         │  + WebSocket│                ▼ /app/data/bt3/           │
└──────────────────────────┘             │ bt3-builder (emsdk + python + bun)        │
                                         │  vigia o volume, confere a ISO, compila   │
                                         └───────────────────────────────────────────┘
```

### 1. Servidor do HypeMeet: `server/bt3/`

Tudo do plugin roda no processo do HypeMeet (`server/index.ts`), em módulos pequenos e testáveis:

- **`pass.ts` — passe de acesso.** `POST /api/plugins/bt3/open { token }` confere o token da sala (o mesmo
  `verifier` do `/api/cast`) e devolve `{ url: "/plugins/bt3/p/<passe>/" }`. O passe é
  `base64url(JSON { identidade, nome, expiração })` + `.` + HMAC-SHA256 com `LIVEKIT_API_SECRET`, válido
  por 12 h (o nome aparece em "Fulano está enviando a ISO"). Ele
  substitui a chave `BT3_KEY` do projeto original: sem passe válido, tudo sob `/plugins/bt3/p/` responde 403.
  O passe vai no caminho porque o iframe não manda cabeçalhos e, no Discord, não tem cookie.
- **`routes.ts` — o que é servido em `/plugins/bt3/p/<passe>/`:**
  - `` (raiz) → a página do plugin (`plugins/bt3/page/index.html`, ver 3).
  - `status` → estado do envio e da compilação (JSON, ver Estados).
  - `upload` → envio da ISO (ver 4).
  - `retry` → depois de uma falha, deixa o arquivo `retry` no volume para o builder tentar de novo.
  - `game/<arquivo>` → os arquivos do jogo compilado, de uma lista fixa (`index.html`, `net.js`, `net.css`,
    `bt3-jspi.js`, `bt3-jspi.wasm`, `bt3-async.js`, `bt3-async.wasm`, `icon-180.png`, `icon-192.png`,
    `icon-512.png`, `manifest.webmanifest`). Nada fora dessa lista.
  - `game/disc/index.json` e `game/disc/NNNNN.bin` → a ISO em pedaços de 1 MiB, lidos direto da ISO por
    deslocamento (sem duplicar os 4 GB no disco). É o formato que a página do jogo já lê (`pieceDisc`).
  - `game/net/ws`, `game/net/queue` → as salas do online (WebSocket, ver `rooms.ts`).
  - `game/net/stat`, `game/net/log`, `game/telemetry` → 204, sem guardar nada.
- **Cabeçalhos em tudo sob `/plugins/bt3/`:**
  - `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-downloads;
    frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com` — mesmo
    aberta direto na barra de endereço, a página roda numa origem opaca, sem acesso ao HypeMeet.
  - `Access-Control-Allow-Origin: *` — a origem opaca faz todo `fetch` (inclusive o do `.wasm`) ser
    cross-origin.
  - Tipos certos (`application/wasm`, `text/javascript`…) e `Cache-Control: private, max-age=31536000,
    immutable` nos pedaços do disco; `no-cache` no resto.
- **`rooms.ts` — salas do online.** Port do `cloudflare/src/room.js` (Durable Object) para memória do
  processo, com o mesmo protocolo que o `net.js` do jogo fala: `role=host|join`, `phase=lobby|session`,
  mensagens `peer`, `wait`, `taken`, `full`, `nohost`, `sig`, `go`, `relay`, `bye`, `left`, `ping/pong`,
  pacotes binários repassados ao outro jogador, e o Quick Match (`match`, `count`). A lógica fica numa
  classe que recebe "sockets" abstratos, para testar sem rede; `index.ts` liga ela ao `websocket` do
  `Bun.serve`.
- **`manifest`** — `GET /plugins/bt3/hypemeet-plugin.json` (público, sem nada do jogo):
  `{ id: "bt3", name: "Budokai Tenkaichi 3", description: "Luta 1x1 online ou local. Cada um precisa ter o
  jogo.", icon: "/plugins/bt3/icon.svg", entry: "/plugins/bt3/" }`, com um ícone SVG nosso.
- **Liga/desliga:** `BT3_PLUGIN` (padrão `1` no `docker-compose.prod.yml`; `0` tira o plugin da lista e
  todas as rotas respondem 404). No `bun run dev` fica ligado.

### 2. Cliente do HypeMeet: `src/room/plugins.tsx` e `src/lib/api.ts`

- **Plugins embutidos.** `PluginInfo` ganha `builtin?: true`. `/api/plugins` devolve os externos (como hoje)
  mais o `bt3` quando `BT3_PLUGIN` está ligado.
  - O filtro que hoje descarta plugins da mesma origem passa a manter os embutidos.
  - No Discord, os embutidos pulam o `reachable`/`proxied`: o endereço já é relativo ao site, e o URL
    mapping `/` existente cobre `/plugins/bt3/`.
  - Ao abrir um embutido, o `PluginView` pede o endereço com passe (`api.pluginOpen(id, token)`) antes de
    montar o iframe; enquanto isso, mostra "Abrindo…"; se falhar, mostra o erro no próprio tile. Para isso
    o token da sala desce de `RoomPage`/`DiscordActivity` até o `RoomView`.
  - A regra que já existe (`opaque` quando a origem do plugin é a do site) tira o `allow-same-origin`
    do sandbox. Nada muda nela.
- **Permissões do iframe** (todos os plugins): `allow="clipboard-read; clipboard-write; gamepad; autoplay;
  fullscreen"`. A lista vira uma constante exportada (`PLUGIN_FRAME_ALLOW`) e o sandbox uma função
  (`pluginSandbox(opaque)`), para os testes.

### 3. Página do plugin: `plugins/bt3/page/index.html`

Uma página estática (HTML + JS sem build), no visual escuro do HypeMeet, que lê `status` a cada 2 s e
mostra um de:

| Estado | Tela |
| --- | --- |
| `empty` | "Enviar a ISO do jogo" (escolher arquivo) + aviso: só a versão americana (SLUS-21678), uma vez para o servidor todo |
| `uploading` | barra de envio (bytes e %), de quem está enviando; quem não está enviando vê "Fulano está enviando a ISO" |
| `queued` / `building` | passo atual do builder (`n/total` + nome) e tempo decorrido |
| `failed` | a mensagem do builder (ex.: "Essa ISO não é a versão americana") + "Tentar de novo" ou "Enviar outra ISO" |
| `ready` | navega para `game/` (o jogo) |
| `offline` | "O compilador não está rodando no servidor" (o builder não dá sinal há mais de 2 min) |

O envio usa `File.slice` em pedaços de 32 MiB (abaixo do limite de 100 MB de proxies como o Cloudflare),
com `PUT upload?offset=N&size=TOTAL`; antes de começar e depois de cada erro, `GET upload` diz quantos
bytes o servidor já tem, e o envio continua dali.

### 4. Envio da ISO (servidor)

- Arquivos em `/app/data/bt3/`: `upload/disc.iso.part` + `upload/state.json` (`{ size, received, by, at }`),
  depois `disc.iso`.
- Aceita tamanho entre 1 GiB e 9 GiB. Um envio por vez: outro passe recebe 409 enquanto o atual mandou algo
  nos últimos 2 min; depois disso, quem chegar assume do ponto em que parou.
- Só aceita o pedaço cujo `offset` é exatamente o que já foi recebido (409 com o valor certo, se não).
- Completo: renomeia para `disc.iso`; o builder vê o arquivo e começa. Com `disc.iso` já presente, novo
  envio recebe 409 (o builder apaga a ISO quando a recusa, liberando outro envio).
- O servidor do HypeMeet nunca escreve `status.json`: só o builder escreve. O servidor deixa arquivos
  (`disc.iso`, `retry`) e lê o estado.

### 5. Builder: `plugins/bt3/builder/`

- **Imagem** (`Dockerfile`): `emscripten/emsdk:6.0.13` (o projeto compila com a 6.0), mais python3 com
  `splat64[mips]==0.50.0` já instalado, mais o binário do Bun. O código do jogo entra por
  `git clone` do fork no commit fixo acima. **Sem nada da ISO na imagem.**
- **Laço** (`builder.ts`, rodando com Bun): a cada 5 s escreve um sinal de vida em `status.json` (`at`) e
  compila quando existe `disc.iso` e não existe `build/` dela (ou quando aparece o arquivo `retry`, que ele
  apaga ao começar):
  1. **Conferir a ISO** — os passos `step_disc` do `install.py` (checksum do SLUS-21678). Falha → `failed`
     com mensagem clara e `disc.iso` apagada, para outro envio.
  2. **Extrair os dados** — `step_gamedata` e `step_split` do `install.py`, chamados por um script
     Python pequeno que importa o `install.py` e pula requisitos nativos, build x86 e autoteste.
  3. **Compilar** — `port/web/build.py` e `port/web/link.py web` + `link.py webasync`.
  4. **Ajustar caminhos** — `patch.ts` troca os caminhos absolutos da página e do `net.js` por relativos
     (ver 6) e falha se algum trecho esperado não for encontrado.
  5. **Publicar** — copia a lista fixa de arquivos para `/app/data/bt3/build.tmp/` e troca por `build/`
     de uma vez; estado `ready`.
  Cada passo atualiza `step`, `total`, `label` e a saída vai para `/app/data/bt3/build.log`. Os
  intermediários ficam em `/app/data/bt3/work/` (reaproveitados se precisar compilar de novo).
- **Compose:** serviço `bt3-builder` no `docker-compose.prod.yml`, com o volume `hypemeet-data` montado em
  `/app/data`, `cpus: "2"` para não pesar nas chamadas, `restart: unless-stopped`. Parado (sem nada para
  compilar), só acorda a cada 5 s.

### 6. Ajuste no jogo (`patch.ts`)

O jogo vive em `/plugins/bt3/p/<passe>/game/`, e no Discord em
`https://<app>.discordsays.com/plugins/bt3/p/<passe>/game/`. Os caminhos absolutos quebram nos dois:

| Arquivo | De | Para |
| --- | --- | --- |
| `index.html` (shell) | `pieceDisc('/disc')` | `pieceDisc('disc')` |
| `index.html` | `Q.get('disc') \|\| '/disc.iso'` | `Q.get('disc') \|\| 'disc.iso'` |
| `index.html` | `fetch('/telemetry'` | `fetch('telemetry'` |
| `net.js` | `` `…://${location.host}/net/ws?room=` `` (e `/net/queue`) | endereço montado a partir de `new URL('net/…', location.href)`, trocando `http` por `ws` |
| `net.js` | `fetch('/net/stat'` | `fetch('net/stat'` |

E um trecho a mais no `index.html`: impedir que F1 (configurações do jogo), Tab e Esc façam a ação do
navegador quando o foco está no jogo (`preventDefault` só nessas teclas, só no canvas).

## Estados (`status.json`)

`empty` → `uploading` → `queued` → `building` (`step` 1–5) → `ready`, ou `failed` (`message`).

- O servidor deriva `empty` (sem ISO nem envio) e `uploading` (envio em andamento) dos arquivos de envio.
- `queued` é `disc.iso` presente com o builder ainda sem começar; `building`, `ready` e `failed` vêm do
  `status.json` do builder.
- `offline` é calculado pelo servidor quando o `at` do builder tem mais de 2 min.
- "Tentar de novo" (`retry`) faz o builder recomeçar; se ele tinha recusado e apagado a ISO, o estado volta a
  `empty` e a página pede outra.

## Segurança e direitos

- **Quem acessa:** só quem tem passe, e passe só sai para token válido de uma sala existente. O HypeMeet não
  tem contas, então isso protege de quem não está nas salas, não de quem entra numa sala; por isso o servidor
  precisa continuar privado. Isso vai escrito no README.
- **Isolamento:** a página e o jogo rodam sempre em origem opaca (sandbox no iframe e no cabeçalho CSP), sem
  acesso a `localStorage`, cookies ou sessão do HypeMeet.
- **Arquivos:** só a lista fixa do jogo e os pedaços do disco são servidos; o resto de `/app/data/bt3/`
  (ISO inteira, `work/`, logs) nunca sai do servidor. O `.gitignore` e o `.dockerignore` cobrem `data/`.

## Erros

| Situação | O que acontece |
| --- | --- |
| ISO de outra região ou modificada | `failed`: "Essa ISO não é a versão americana sem modificações (SLUS-21678)"; botão "Enviar outra ISO" |
| Conexão cai no envio | a página retoma do último pedaço aceito |
| Compilação falha | `failed` com as últimas linhas do log; "Tentar de novo" |
| Builder fora do ar | `offline` na página |
| Passe vencido (sala aberta > 12 h) | 403 → a página pede para fechar e abrir o plugin de novo |
| O outro jogador não conecta direto (WebRTC) | o jogo já repassa os pacotes pelo WebSocket da sala (relay) |

## Testes

Automatizados (`bun test`, ao lado do código, como os de `server/`):

- `server/bt3/pass.test.ts` — passe válido, vencido, adulterado, de outra identidade; token de sala inválido.
- `server/bt3/rooms.test.ts` — host e join se encontram (`peer`); segundo host (`taken`); join sem host
  (`nohost`); recarregar com o mesmo `cid` substitui; `sig`/`go`/`relay`/`bye` e binário chegam ao outro;
  saída avisa `left`; sessão espera o outro; Quick Match pareia dois e manda `match` com código e lados.
- `server/bt3/routes.test.ts` — 403 sem passe; manifest público; cabeçalhos CSP/CORS; só arquivos da lista;
  `index.json` e pedaços com o tamanho e o conteúdo certos (ISO falsa pequena); último pedaço menor;
  `BT3_PLUGIN=0` → 404.
- `server/bt3/upload.test.ts` — envio em pedaços, offset errado (409), retomada, envio concorrente (409),
  tamanho fora do limite, conclusão vira `queued`.
- `plugins/bt3/builder/patch.test.ts` — com trechos reais do `shell.html`/`net.js` do commit fixo: troca
  tudo, falha alto se algum trecho sumir, não sobra caminho absoluto.
- `plugins/bt3/builder/builder.test.ts` — o laço com comandos falsos: passos em ordem, estado e log, falha
  num passo vira `failed`, ISO recusada apaga a ISO, publica trocando `build/` de uma vez.
- `src/room/plugins.test.ts` — `PLUGIN_FRAME_ALLOW` tem `gamepad`, `autoplay`, `fullscreen` e as de antes;
  `pluginSandbox(true)` não tem `allow-same-origin`; embutidos passam pelo filtro de mesma origem e não pelo
  `proxied`.
- Suíte inteira, `bun run typecheck` e `bun run build` antes de cada commit.

Manuais, no navegador interno (nunca abrir janela externa):

- Plugin na sala: envio da ISO real, progresso, compilação de verdade no Docker local, jogo carregando.
- Teclado e mouse dentro da sala: navegar nos menus pelo teclado, F1 abre as configurações do jogo (e não a
  ajuda do navegador), clicar nos menus da página e do F1.
- Duas abas na mesma sala: uma cria a sala no Dragon Net Battle, a outra entra com o código, luta começa.
- Abrir `/plugins/bt3/p/<passe>/` direto: continua em origem opaca (sem `localStorage` do HypeMeet).

No Discord (o dono valida): plugin aparece e carrega, teclado/mouse, online entre dois, controle.

## Fora deste trabalho

- Cada amigo escolher a própria ISO no navegador (commit seguinte).
- Saves e configurações persistentes.
- Desafiar alguém direto pela sala do HypeMeet (sem código).
- Firefox (o port web pede JSPI ou Asyncify; não foi testado lá pelo projeto).

## Riscos

- **Recursos do servidor na compilação:** CPU (limitada a 2), memória e ~10 GB de disco (ISO, extração,
  imagem de build). Uma vez só por ISO.
- **Discord:** controle (depende do Discord liberar `gamepad` para atividades) e velocidade de leitura dos
  pedaços pelo proxy dele.
- **Port do jogo:** depende de um fork de terceiros num commit fixo; trocar de commit pode exigir revisar o
  `patch.ts` (que falha alto se algo mudar).
