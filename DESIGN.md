# Design do HypeMeet — Adesivo Noite

Grafite frio, um roxo-uva de marca e **cor só onde tem gente**. Cada pessoa da sala ganha uma cor de
adesivo que a acompanha em tudo (avatar, moldura do tile, anel de quem fala, nome no chat, tinta na
tela); o resto da interface fica neutro e quieto, porque quem tem que aparecer é a tela compartilhada e
a galera. Os cantos arredondados, a borda fina de "recorte" e o "Meet" inclinado no logo guardam o jeito
de figurinha, sem bagunça em cima da chamada.

As fontes de verdade são o código: tokens em [`src/index.css`](src/index.css), kit de componentes em
[`src/components/ui.tsx`](src/components/ui.tsx) e cores das pessoas em
[`src/lib/color.ts`](src/lib/color.ts). Este documento explica as regras; se divergir do código, o
código vence e este arquivo deve ser corrigido. O mockup que deu origem à direção está em
[`design/adesivo-noite.html`](design/adesivo-noite.html) (abra no navegador; `?view=home|room|mobile|tokens`).

## Princípios

1. **Cor = pessoas + uma marca.** Superfícies, bordas e texto são neutros. O uva (`accent`) marca a ação
   principal, o estado ativo e o foco; as cores de pessoa marcam quem é quem. Nada mais ganha cor.
2. **Texto escuro em todo preenchimento colorido.** Branco no uva dá 3,5:1 e no vermelho 3:1, então
   qualquer fundo colorido (uva, perigo, aviso, cor de pessoa) usa `text-on-accent` (#121019). Nunca
   `text-ink` em cima de `bg-accent`/`bg-danger`.
3. **Perigo e aviso são funcionais.** `danger` só para microfone mutado, Sair, "Ao vivo", erros e ações
   destrutivas; `warn` só para conexão ruim. Câmera desligada é estado neutro, não alarme.
4. **Vídeo é conteúdo.** Em cima de tela/câmera vão chips `scrim` (escuros, translúcidos, com blur).
   Só a etiqueta "Tela de Fulano" (cor de quem transmite) e "Ao vivo" (perigo) são preenchidas.
5. **Adesivo discreto.** Borda de recorte de 2px (`border-line`), sombra baixa e macia, cantos generosos.
   Nada de gradiente, brilho ou aurora. Inclinação só nas marcas da marca (wordmark e o "H").
6. **Contraste medido.** Texto do corpo e `soft` passam de 4,5:1 em todas as superfícies; não reduza a
   opacidade de texto que carrega informação.

## Cores

Tokens do `@theme` (viram classes Tailwind: `bg-panel`, `text-soft`, `border-line`…).

| Token | Valor | Uso | Contraste |
| --- | --- | --- | --- |
| `canvas` | `#131418` | Fundo da página | — |
| `panel` | `#1a1c22` | Cards, chat, menus | — |
| `surface` | `#23262e` | Campos, botões, tiles | — |
| `surface-hi` | `#2e313b` | Hover, selecionado, trilhos | — |
| `line` | `#383b47` | Bordas e o recorte de 2px | — |
| `accent` | `#9070ff` | Uva: ação principal, ativo | `on-accent` sobre ele: 5,3:1 |
| `accent-hi` | `#b1a0ff` | Hover do uva, links, foco, texto uva | 5,8:1 no `surface-hi` |
| `ink` | `#f2f3f7` | Texto principal | ≥11,7:1 |
| `on-accent` | `#121019` | Texto sobre qualquer preenchimento colorido | — |
| `soft` | `#a4a9b8` | Texto secundário | ≥5,5:1 (pior caso: `surface-hi`) |
| `danger` | `#ff5c6f` | Mudo, Sair, Ao vivo, erro | `on-accent` sobre ele: 6,3:1; como texto ≥5:1 até `surface` (no `surface-hi`, só ícone) |
| `warn` | `#ffb547` | Conexão ruim | ≥7,4:1 |
| `scrim` | `rgb(19 20 24 / .74)` | Chips sobre vídeo (com `backdrop-filter`) | — |

### Cores das pessoas

`PERSON_COLORS` em `src/lib/color.ts`: tangerina `#ff9b5e`, chiclete `#ff85c2`, menta `#54dfb1`,
sol `#ffd45e`, céu `#62c4ff`, lima `#b5e35c`, orquídea `#e89bff`, areia `#e6c69a`.

- Dentro da sala, cada pessoa tem uma cor só dela: o `RoomView` chama `assignPersonColors` com os
  `identity` em ordem de entrada, e cada um pega a cor do **hash do `identity`** ou, se alguém que
  entrou antes já tem essa, a próxima livre (com mais de 8 pessoas as cores repetem). A ordem de
  entrada vem do servidor, então a cor é a mesma em todas as telas e é a mesma da tinta
  (`ink.tsx` usa `personColor`). Se quem tinha a cor sai, quem foi empurrado (e quem caiu na cor seguinte por causa dele) pode trocar
  de cor.
  Use sempre o `identity`, nunca o apelido. Fora de sala (salas salvas na home), vale o hash puro e o
  código da sala é a semente. O card de convite (`server/og.ts`) só conhece os apelidos e faz a mesma
  distribuição sobre eles.
- O uva da marca e tons próximos do vermelho de perigo ficam fora da lista: ninguém parece
  "selecionado" nem "em alerta" só pela cor.
- Todas aceitam texto escuro (≥8:1) e funcionam como texto sobre `panel` (≥7,6:1).
- No CSS, a cor entra como `--p` (`style={personStyle(identity)}`) e as utilities leem dela:
  `person-tag` (etiqueta preenchida), `person-frame` (moldura do tile a 45%), `person-speaking`
  (anel + brilho de quem fala). Em Tailwind: `text-(--p)`, `bg-(--p)`.

## Tipografia

Fontes self-hosted via fontsource (a CSP da Atividade do Discord bloqueia fontes de CDN).

| Papel | Fonte | Uso |
| --- | --- | --- |
| `font-display` | Bricolage Grotesque (variável, com `opsz`) | Títulos, nomes, wordmark, etiquetas de pessoa, "Sair" — sempre `font-extrabold` |
| `font-sans` | DM Sans (variável, com `opsz`) | Interface e texto; rótulos e botões em `font-bold` |
| `font-mono` | DM Mono 500 | Código da sala, teclas, números técnicos |

Utilities: `type-heading-sm` (22px display), `type-link` (15px bold), `type-link-sm` (14px bold),
`type-label` (11px, caixa-alta espaçada, para títulos de seção de menu). O `server/og.ts` usa os
arquivos `.woff` estáticos de `@fontsource/bricolage-grotesque` e `@fontsource/dm-sans` (o satori não lê
woff2).

## Forma e profundidade

- **Raios:** `xs` 8 · `sm` 12 · `md` 16 (tiles, campos) · `lg` 20 (tela fixada, cards de sala) ·
  `xl` 24 (cards e painéis grandes) · `rounded-full` para botões, chips e controles ·
  `rounded-blob` (forma de figurinha recortada à mão) para avatares de pessoa e o selo da sala.
- **Recorte:** `sticker` = borda de 2px `line` + `shadow-sticker`. Em preenchimentos coloridos, a borda é
  a própria cor misturada com branco (ex.: botão primário com borda `accent-hi`).
- **Sombras:** `shadow-sticker` (baixa, para botões e tiles) e `shadow-float` (cards, painéis, menus).
- **Estados:** hover = sobe 1px + `surface-hi`; pressionado = desce 1px e perde a sombra; foco = contorno
  tracejado de 2px em `accent-hi` (global, em `:focus-visible` — não remova).

## Componentes (`src/components/ui.tsx`)

- **`Button` / `buttonClass`:** pílula com recorte, `size="md"` (48px, padrão) ou `"sm"` (40px).
  `primary` = uva com texto escuro; `ghost` = `surface`; `danger` = vermelho com texto escuro. `square`
  para só ícone. Para mudar altura/padding, use `size`: classes passadas por `className` para a mesma
  propriedade perdem para as do kit na ordem do CSS gerado (só `!` vence).
- **Ação destrutiva secundária** (Parar, Encerrar pra todos, Mudo): contorno de perigo (borda 40% de
  `danger` sobre a superfície) com `text-danger`; no hover vira perigo sólido com texto escuro. Nada de
  fundo `danger/15` com texto vermelho, que fica abaixo de 4,5:1.
- **`chipClass`:** pílula neutra pequena (código da sala, contadores, metadados).
- **`scrimClass`:** pílula sobre vídeo.
- **`personTagClass`:** etiqueta preenchida na cor da pessoa (use com `personStyle`).
- **`kbdClass`:** tecla (ex.: "Segure [V] para falar"). **`countClass`:** selo de contagem uva.
- **`Avatar`:** pessoa = blob na cor da pessoa com iniciais escuras (`seed={identity}`); sala
  (`shape="square"`) = selo tonal (16% da cor + iniciais coloridas). Com foto (Discord), círculo.
- **`Field` + `inputClass`:** rótulo em negrito acima, ícone opcional à esquerda, campo de 52px com
  recorte; foco troca a borda para uva.
- **`cardClass`:** painel `panel`, recorte de 2px, raio 24, `shadow-float`.
- **`Logo`:** "Hype" + "Meet" num adesivo uva inclinado −3°. **`LogoMark`:** o "H" uva
  (`public/favicon.svg`; `desktop/icon.png` é renderizado dele).

## Layout

- **Moldura (`AppShell`):** em volta da home e da sala, no jeito do Discord. Trilho de 72px (`canvas`)
  com o "H" (Grupos), um fio e os servidores do Discord de quem entrou (ícone num quadrado `rounded-md`
  ou `Avatar` quadrado; servidor sem o bot fica apagado); o selecionado ganha a pílula uva na borda
  esquerda. Barra lateral de 256px (`panel`, fio de 2px à direita): cabeçalho de 56px com o nome, a
  lista e o painel da conta embaixo.
- **Barra lateral:** em Grupos, "Criar ou entrar" e "Seus grupos" (as salas salvas); num servidor, os
  canais de voz na ordem do Discord, com as categorias em `type-label`. Linha atual = `surface-hi` +
  `aria-current` (no canal, o alto-falante fica `accent-hi`); canal sem acesso = cadeado, apagado e desabilitado.
  Embaixo da linha, quem está ali: num canal, primeiro quem está na call do Discord (avatar, nome e o
  microfone/fone cortado em `soft` quando mutado/ensurdecido, que é escolha da pessoa, não perigo; o "H"
  pequeno marca quem também está na sala do HypeMeet), depois quem está só no HypeMeet; até 5 no total,
  depois "+N". Sem o Gateway do bot, só a sala aparece. Servidor sem o bot: texto curto e "Adicionar ao
  servidor" (primário) para quem pode.
- **Painel da conta:** avatar do Discord, nome, `@usuário` e o ícone de sair (neutro). Visitante vê
  "Entrar com o Discord" (primário) quando o login está configurado.
- **Gaveta:** abaixo de `lg` (a sala com o chat aberto não cabe ao lado da barra), trilho e barra lateral
  viram uma gaveta por cima do `scrim` (fecha no fundo, no Esc e ao navegar; o resto fica `inert`). A home
  abre pelo botão de menu do cabeçalho; a sala, pelo "H" do cabeçalho (`useShell().openNav()`).
- **Home:** card de criar/entrar (manchete em Bricolage, apelido, alternância Criar/Entrar, botão
  primário largo), centralizado; as salas salvas ficam na barra lateral. Abaixo de `lg`, "Seus grupos"
  vem embaixo do card, com selo, código, tempo e quem está lá agora.
- **Sala:** cabeçalho (o "H", que na moldura abre a gaveta e some a partir de `lg`, onde o trilho já o
  mostra; nome, código copiável, rostos de quem está na sala + contagem,
  "Convidar") → palco (tela fixada grande e a fileira das outras câmeras embaixo, dividindo a largura;
  ou a grade que maximiza os tiles, 16:9 no desktop e até quadrados num palco em pé, como no celular) →
  chat ancorado à direita (352px, 416px a partir de `xl`) → dock centralizado embaixo do palco.
- **Dock:** botões redondos de 56px a partir de `md` (48px abaixo) em grupos separados por um fio: microfone/câmera
  (com chevron de dispositivo) | tela, reações, assistir junto, soundboard, plugins | chat e Sair.
  Ligado/aberto = uva com ícone escuro; microfone mutado = tom de perigo; câmera desligada = neutra.
  "Segure [V] para falar" fica na mesma linha, depois do Sair, quando o push-to-talk está ativo (a partir
  de `lg`).
- **Celular / Atividade pequena:** abaixo de `sm`, Reações, Assistir junto, Soundboard e Plugins vão
  para o botão "Mais"; microfone, câmera, tela, chat e Sair continuam no dock. Na janelinha (PiP) do
  Discord, cabeçalho e dock somem e fica só a imagem.

- **Tiles:** moldura e etiqueta na cor da pessoa (na tela transmitida pelo app do Discord, a cor é de
  quem é dono da transmissão). Em tiles estreitos (< 20rem) a tela mostra só o essencial: barras, olho
  com a contagem, o botão "Assistir" e a etiqueta; "Ao vivo" e os rostos de quem assiste somem.

## Limites conhecidos

- A tinta usa as cores das pessoas, que são claras: sobre uma tela compartilhada branca o traço fica
  com pouco contraste (o halo escuro do `InkLayer` ajuda, mas não resolve).
- O `identity` muda a cada conexão, então a cor de alguém pode mudar quando a pessoa reentra; mensagens
  antigas dela no chat (histórico repassado) ficam com a cor do hash e do lado de "outra pessoa".
- O card de convite (`server/og.ts`) só conhece os apelidos, então as cores dele não batem com as da sala.

## Fora do app React

- `server/og.ts`: card de convite (1200×630) com o mesmo fundo, wordmark, fontes e cores de pessoa.
- `desktop/pages/style.css`: seletor de tela e configuração do app desktop, com os mesmos valores de
  token (copiados à mão — mantenha em sincronia com `src/index.css`).
- `index.html` (`theme-color`) e `desktop/main.js` (`BACKGROUND`) usam `canvas` (#131418).
