import { Resvg, initWasm } from "@resvg/resvg-wasm";
import satori from "satori";
import { join } from "node:path";

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
  ["Hanken Grotesk", 800, "@fontsource/hanken-grotesk/files/hanken-grotesk-latin-800-normal.woff"],
  ["Hanken Grotesk", 800, "@fontsource/hanken-grotesk/files/hanken-grotesk-latin-ext-800-normal.woff"],
  ["Hanken Grotesk", 700, "@fontsource/hanken-grotesk/files/hanken-grotesk-latin-700-normal.woff"],
  ["Hanken Grotesk", 700, "@fontsource/hanken-grotesk/files/hanken-grotesk-latin-ext-700-normal.woff"],
  ["Inter", 500, "@fontsource/inter/files/inter-latin-500-normal.woff"],
  ["Inter", 500, "@fontsource/inter/files/inter-latin-ext-500-normal.woff"],
  ["Inter", 600, "@fontsource/inter/files/inter-latin-600-normal.woff"],
  ["Inter", 600, "@fontsource/inter/files/inter-latin-ext-600-normal.woff"],
] as const;

const ready = (async () => {
  const [fonts, logo] = await Promise.all([
    Promise.all(fontFiles.map(async ([name, weight, spec]) => ({ name, weight, data: await read(spec) }))),
    Bun.file(join(import.meta.dir, "..", "public", "favicon.svg")).text(),
    initWasm(read("@resvg/resvg-wasm/index_bg.wasm")),
  ]);
  return { fonts, logo: svgData(logo) };
})();

function svgData(svg: string | ArrayBuffer): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg as string).toString("base64")}`;
}

// Violet light for atmosphere, same mood as the app's hero glow. Drawn as plain SVG because
// satori's radial-gradient rasterizes into hard-edged blocks.
const BACKDROP = svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  <radialGradient id="a" cx="1040" cy="20" r="680" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#7457ff" stop-opacity=".5"/><stop offset="1" stop-color="#7457ff" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="b" cx="60" cy="720" r="560" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#5865f2" stop-opacity=".26"/><stop offset="1" stop-color="#5865f2" stop-opacity="0"/>
  </radialGradient>
  <rect width="100%" height="100%" fill="#07070c"/>
  <rect width="100%" height="100%" fill="url(#a)"/>
  <rect width="100%" height="100%" fill="url(#b)"/>
</svg>`);

// lucide arrow-right; the latin font subsets have no "→".
const ARROW = svgData(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
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

// Mirrors Avatar in src/components/ui.tsx so people look the same in the preview and in the call.
const AVATAR_FILLS = [
  ["#7457ff", "#5865f2"],
  ["#5865f2", "#3d47c9"],
  ["#9a6bff", "#5b3fd6"],
  ["#4c5bd4", "#2b2f7a"],
];
function avatar(name: string, index: number): Node {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => [...p][0]!.toUpperCase())
      .join("") || "?";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const [from, to] = AVATAR_FILLS[Math.abs(hash) % AVATAR_FILLS.length]!;
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 76,
        height: 76,
        marginLeft: index === 0 ? 0 : -18,
        borderRadius: 999,
        border: "5px solid #07070c",
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        fontFamily: "Hanken Grotesk",
        fontWeight: 700,
        fontSize: 26,
        color: "#fff",
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
        marginLeft: -18,
        borderRadius: 999,
        border: "5px solid #07070c",
        backgroundColor: "#191926",
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: 24,
        color: "#a0a2b8",
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
        padding: "12px 24px",
        borderRadius: 999,
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: 24,
        ...style,
      },
    },
    ...children,
  );
}

function card({ name, code, people = [] }: InviteCard, logo: string): Node {
  const live = people.length > 0;
  const shown = people.length > 5 ? people.slice(0, 4) : people;
  const titleSize = !name ? 92 : name.length <= 14 ? 112 : name.length <= 26 ? 92 : 72;

  const header = h(
    "div",
    { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 20 } },
      h("img", { src: logo, width: 64, height: 64 }),
      h(
        "div",
        { style: { display: "flex", fontFamily: "Hanken Grotesk", fontWeight: 800, fontSize: 38, letterSpacing: -0.4 } },
        h("span", { style: { color: "#fff" } }, "HYPE"),
        h("span", { style: { color: "#8b93ff" } }, "MEET"),
      ),
    ),
    live
      ? pill(
          [
            h("div", { style: { width: 14, height: 14, borderRadius: 999, backgroundColor: "#f0384c" } }),
            `AO VIVO · ${people.length} na sala`,
          ],
          { backgroundColor: "rgba(240, 56, 76, 0.14)", border: "2px solid rgba(240, 56, 76, 0.4)", color: "#fff" },
        )
      : code
        ? pill([formatCode(code)], {
            backgroundColor: "#11111b",
            border: "2px solid rgba(255, 255, 255, 0.07)",
            color: "#a0a2b8",
            letterSpacing: 4,
          })
        : null,
  );

  const title = h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 18 } },
    h(
      "div",
      { style: { fontFamily: "Inter", fontWeight: 500, fontSize: 30, color: "#a0a2b8" } },
      name ? "Você foi chamado pra sala" : "Chamada de voz e vídeo pra galera",
    ),
    h(
      "div",
      {
        style: {
          display: "block",
          fontFamily: "Hanken Grotesk",
          fontWeight: 800,
          fontSize: titleSize,
          lineHeight: 1.02,
          letterSpacing: -titleSize * 0.02,
          color: "#fff",
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
            ...shown.map(avatar),
            people.length > shown.length ? extra(people.length - shown.length) : null,
          )
        : null,
      h(
        "div",
        {
          style: {
            display: "block",
            fontFamily: "Inter",
            fontWeight: live ? 600 : 500,
            fontSize: 30,
            color: live ? "#fff" : "#a0a2b8",
            lineClamp: 2,
          },
        },
        name ? presenceLine(people) : "Sem conta, sem instalar nada. É só mandar o link.",
      ),
    ),
    name
      ? pill(["Entrar na sala", h("img", { src: ARROW, width: 30, height: 30 })], {
          flexShrink: 0,
          padding: "18px 34px",
          fontSize: 28,
          color: "#fff",
          backgroundColor: "#5865f2",
          boxShadow: "0 18px 50px -12px rgba(116, 87, 255, 0.7)",
        })
      : null,
  );

  return h(
    "div",
    {
      style: {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: OG_WIDTH,
        height: OG_HEIGHT,
        padding: "64px 72px",
      },
    },
    h("img", { src: BACKDROP, width: OG_WIDTH, height: OG_HEIGHT, style: { position: "absolute", top: 0, left: 0 } }),
    header,
    title,
    footer,
  );
}

export async function renderInviteCard(input: InviteCard): Promise<Uint8Array> {
  const { fonts, logo } = await ready;
  const svg = await satori(card(input, logo) as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts.map((f) => ({ ...f, style: "normal" as const })),
    loadAdditionalAsset: async (language, segment) => (language === "emoji" ? loadEmoji(segment) : []),
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
}
