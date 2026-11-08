import { Resvg, initWasm } from "@resvg/resvg-wasm";
import satori from "satori";

// Link previews (WhatsApp, Discord, Telegram…) for invite links: a 1200×630 PNG with the room name
// and who's in it. Satori lays out the card and turns text into paths; resvg rasterizes the SVG.
// WhatsApp and friends don't render SVG og:images, hence the PNG step.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface InviteCard {
  /** Room name; null renders the generic HypeMeet card (home page, unknown room). */
  name: string | null;
  code?: string;
  /** Display names of who's in the room right now. */
  people?: string[];
}

const resolve = (spec: string) => Bun.resolveSync(spec, import.meta.dir);
const read = (spec: string) => Bun.file(resolve(spec)).arrayBuffer();

// Satori needs ttf/otf/woff (not woff2), so these come from the static @fontsource packages.
// latin covers Portuguese; latin-ext catches the rest of Europe.
const fontFiles = [
  ["Bricolage Grotesque", 800, "@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff"],
  ["Bricolage Grotesque", 800, "@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-ext-800-normal.woff"],
  ["DM Sans", 500, "@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff"],
  ["DM Sans", 500, "@fontsource/dm-sans/files/dm-sans-latin-ext-500-normal.woff"],
  ["DM Sans", 700, "@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff"],
  ["DM Sans", 700, "@fontsource/dm-sans/files/dm-sans-latin-ext-700-normal.woff"],
  ["DM Mono", 500, "@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff"],
] as const;

const ready = (async () => {
  const [fonts] = await Promise.all([
    Promise.all(fontFiles.map(async ([name, weight, spec]) => ({ name, weight, data: await read(spec) }))),
    initWasm(read("@resvg/resvg-wasm/index_bg.wasm")),
  ]);
  return { fonts };
})();

function svgData(svg: string | ArrayBuffer): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg as string).toString("base64")}`;
}

// Adesivo Noite tokens (src/index.css); satori has no CSS variables or color-mix, so literal hexes.
const C = {
  canvas: "#131418",
  panel: "#1a1c22",
  surface: "#23262e",
  surfaceHi: "#2e313b",
  line: "#383b47",
  accent: "#9070ff",
  accentHi: "#b1a0ff",
  ink: "#f2f3f7",
  onAccent: "#121019",
  soft: "#a4a9b8",
  danger: "#ff5c6f",
  // color-mix(danger 55%, white): the rim of the "Ao vivo" sticker.
  dangerRim: "#ffa5b0",
};
const SHADOW_STICKER = "0 1px 0 rgba(0, 0, 0, 0.35), 0 6px 12px -8px rgba(0, 0, 0, 0.7)";

// lucide arrow-right; the latin font subsets have no "→".
const ARROW = svgData(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${C.accentHi}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
);

// Room names love emoji ("Sala do 🎮"); satori asks for each one and we hand back Twemoji SVGs.
// A failed fetch only costs that glyph, never the whole card.
const emojiCache = new Map<string, Promise<string>>();
function loadEmoji(segment: string): Promise<string> {
  const codepoints = [...segment]
    .map((ch) => ch.codePointAt(0)!.toString(16))
    .filter((cp) => cp !== "fe0f")
    .join("-");
  let pending = emojiCache.get(codepoints);
  if (!pending) {
    pending = fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${codepoints}.svg`, {
      signal: AbortSignal.timeout(1500),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return svgData(await res.arrayBuffer());
      })
      .catch(() => {
        emojiCache.delete(codepoints);
        return "";
      });
    emojiCache.set(codepoints, pending);
  }
  return pending;
}

/** "Ana, Bia e mais 2 estão na sala" — shared by the image and the og:description. */
export function presenceLine(people: string[]): string {
  if (people.length === 0) return "Ninguém por lá ainda. Chega primeiro!";
  if (people.length === 1) return `${people[0]} está na sala`;
  if (people.length <= 3) return `${people.slice(0, -1).join(", ")} e ${people.at(-1)} estão na sala`;
  return `${people.slice(0, 2).join(", ")} e mais ${people.length - 2} estão na sala`;
}

/** "ABCDEF" → "ABC-DEF" (server copy of src/lib/code.ts). */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

// --- Tiny element builder: satori takes React-shaped objects, no JSX needed. ---
type Style = Record<string, string | number>;
type Child = Node | string | null | false;
interface Node {
  type: string;
  props: Record<string, unknown>;
}
function h(type: string, props: { style?: Style; [key: string]: unknown }, ...children: Child[]): Node {
  const kids = children.filter((c) => c !== null && c !== false);
  return { type, props: { ...props, children: kids.length > 1 ? kids : kids[0] } };
}

// Server copy of PERSON_COLORS and assignPersonColors in src/lib/color.ts (the source of truth; the
// production image ships server/ without src/). Keep both in sync. Same free-slot walk, so no two
// avatars on the card share a colour.
const PERSON_COLORS = ["#ff9b5e", "#ff85c2", "#54dfb1", "#ffd45e", "#62c4ff", "#b5e35c", "#e89bff", "#e6c69a"];
function personColors(keysInJoinOrder: string[]): string[] {
  const taken = new Set<number>();
  return keysInJoinOrder.map((key) => {
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
    let i = Math.abs(hash) % PERSON_COLORS.length;
    if (taken.size < PERSON_COLORS.length) while (taken.has(i)) i = (i + 1) % PERSON_COLORS.length;
    taken.add(i);
    return PERSON_COLORS[i]!;
  });
}

// Hand-cut sticker blob (--radius-blob).
const BLOB = "52% 48% 55% 45% / 47% 55% 45% 53%";

// Mirrors Avatar in src/components/ui.tsx: a sticker blob in the person's colour, dark initials.
// Presence only knows display names, so the name picks the colour here (not the room's identity
// colour).
function avatar(name: string, index: number, color: string): Node {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => [...p][0]!.toUpperCase())
      .join("") || "?";
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 76,
        height: 76,
        marginLeft: index === 0 ? 0 : -14,
        borderRadius: BLOB,
        border: `5px solid ${C.panel}`,
        backgroundColor: color,
        fontFamily: "Bricolage Grotesque",
        fontWeight: 800,
        fontSize: 28,
        color: C.onAccent,
      },
    },
    initials,
  );
}

function extra(count: number): Node {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 76,
        height: 76,
        marginLeft: -14,
        borderRadius: BLOB,
        border: `5px solid ${C.panel}`,
        backgroundColor: C.surfaceHi,
        fontFamily: "DM Sans",
        fontWeight: 700,
        fontSize: 24,
        color: C.ink,
      },
    },
    `+${count}`,
  );
}

function pill(children: Child[], style: Style = {}): Node {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 22px",
        borderRadius: 999,
        fontFamily: "DM Sans",
        fontWeight: 700,
        fontSize: 24,
        ...style,
      },
    },
    ...children,
  );
}

function card({ name, code, people = [] }: InviteCard): Node {
  const live = people.length > 0;
  const shown = people.length > 5 ? people.slice(0, 4) : people;
  const colors = personColors(shown);
  const titleSize = !name ? 92 : name.length <= 14 ? 112 : name.length <= 26 ? 92 : 72;

  const header = h(
    "div",
    { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
    // Wordmark: "Hype" plus "Meet" on a tilted grape sticker, as in src/components/ui.tsx.
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          fontFamily: "Bricolage Grotesque",
          fontWeight: 800,
          fontSize: 46,
          letterSpacing: -1.4,
          color: C.ink,
        },
      },
      "Hype",
      h(
        "div",
        {
          style: {
            display: "flex",
            marginLeft: 8,
            padding: "2px 16px 9px",
            borderRadius: 17,
            border: `3px solid ${C.accentHi}`,
            backgroundColor: C.accent,
            color: C.onAccent,
            boxShadow: SHADOW_STICKER,
            transform: "rotate(-3deg)",
          },
        },
        "Meet",
      ),
    ),
    live
      ? pill(
          [
            h("div", { style: { width: 12, height: 12, borderRadius: 999, backgroundColor: C.onAccent } }),
            `Ao vivo · ${people.length} ${people.length === 1 ? "pessoa" : "pessoas"} agora`,
          ],
          { backgroundColor: C.danger, border: `2px solid ${C.dangerRim}`, color: C.onAccent, boxShadow: SHADOW_STICKER },
        )
      : code
        ? pill([formatCode(code)], {
            backgroundColor: C.surface,
            border: `2px solid ${C.line}`,
            fontFamily: "DM Mono",
            fontWeight: 500,
            color: C.ink,
            letterSpacing: 1,
          })
        : null,
  );

  const title = h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 18 } },
    h(
      "div",
      { style: { fontFamily: "DM Sans", fontWeight: 500, fontSize: 30, color: C.soft } },
      name ? "Você foi chamado pra sala" : "Chamada de voz e vídeo pra galera",
    ),
    h(
      "div",
      {
        style: {
          display: "block",
          fontFamily: "Bricolage Grotesque",
          fontWeight: 800,
          fontSize: titleSize,
          lineHeight: 1.04,
          letterSpacing: -titleSize * 0.02,
          color: C.ink,
          lineClamp: 2,
        },
      },
      name ?? "Entra, liga a câmera e chama todo mundo.",
    ),
  );

  const footer = h(
    "div",
    { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32 } },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 24, minWidth: 0, flex: 1 } },
      live
        ? h(
            "div",
            { style: { display: "flex", flexShrink: 0 } },
            ...shown.map((person, i) => avatar(person, i, colors[i]!)),
            people.length > shown.length ? extra(people.length - shown.length) : null,
          )
        : null,
      h(
        "div",
        {
          style: {
            display: "block",
            fontFamily: "DM Sans",
            fontWeight: live ? 700 : 500,
            fontSize: 30,
            color: live ? C.ink : C.soft,
            lineClamp: 2,
          },
        },
        name ? presenceLine(people) : "Sem conta, sem instalar nada. É só mandar o link.",
      ),
    ),
    name
      ? pill(
          [
            "Entrar na sala",
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 60,
                  height: 60,
                  borderRadius: 999,
                  backgroundColor: C.onAccent,
                },
              },
              h("img", { src: ARROW, width: 32, height: 32 }),
            ),
          ],
          {
            flexShrink: 0,
            gap: 22,
            padding: "9px 9px 9px 34px",
            border: `3px solid ${C.accentHi}`,
            fontFamily: "Bricolage Grotesque",
            fontWeight: 800,
            fontSize: 30,
            color: C.onAccent,
            backgroundColor: C.accent,
            boxShadow: SHADOW_STICKER,
          },
        )
      : null,
  );

  // A flat panel card on the charcoal canvas, with the 2px die-cut rim of the app's cards.
  return h(
    "div",
    { style: { display: "flex", width: OG_WIDTH, height: OG_HEIGHT, padding: 28, backgroundColor: C.canvas } },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          padding: "40px 46px",
          border: `2px solid ${C.line}`,
          borderRadius: 24,
          backgroundColor: C.panel,
        },
      },
      header,
      title,
      footer,
    ),
  );
}

export async function renderInviteCard(input: InviteCard): Promise<Uint8Array> {
  const { fonts } = await ready;
  const svg = await satori(card(input) as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts.map((f) => ({ ...f, style: "normal" as const })),
    loadAdditionalAsset: async (language, segment) => (language === "emoji" ? loadEmoji(segment) : []),
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
}
