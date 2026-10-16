import type { RoomServiceClient } from "livekit-server-sdk";
import { join } from "node:path";
import { OG_HEIGHT, OG_WIDTH, presenceLine, renderInviteCard, type InviteCard } from "./og";
import { createPreviewPresence } from "./presence";
import type { Room } from "./rooms";

// Link previews: crawlers (WhatsApp, Discord, Telegram, iMessage…) don't run JS, so the server writes
// the Open Graph tags into index.html itself. /r/:code gets the room name, who's there and a card
// rendered on the fly; every other page gets the generic HypeMeet card.

const RENDER_CACHE_MAX = 64;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Public origin as the visitor sees it: behind Traefik the request itself is plain http. */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  return `${proto}://${host}`;
}

interface Meta {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}

function metaTags(m: Meta): string {
  const tags: [string, string, string][] = [
    ["name", "description", m.description],
    ["property", "og:type", "website"],
    ["property", "og:site_name", "HypeMeet"],
    ["property", "og:locale", "pt_BR"],
    ["property", "og:title", m.title],
    ["property", "og:description", m.description],
    ["property", "og:url", m.url],
    ["property", "og:image", m.image],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", String(OG_WIDTH)],
    ["property", "og:image:height", String(OG_HEIGHT)],
    ["property", "og:image:alt", m.imageAlt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", m.title],
    ["name", "twitter:description", m.description],
    ["name", "twitter:image", m.image],
  ];
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`).join("\n    ");
}

export function createLinkPreviews(opts: {
  distDir: string;
  livekit: RoomServiceClient;
  findRoom: (code: string) => Room | null;
}) {
  const presence = createPreviewPresence(opts.livekit);
  let shell: Promise<string> | null = null;
  const indexHtml = () => (shell ??= Bun.file(join(opts.distDir, "index.html")).text());

  // Keyed by what's drawn, not by URL: re-rendering only happens when the room actually changes.
  const renders = new Map<string, Promise<Uint8Array>>();
  function render(card: InviteCard): Promise<Uint8Array> {
    const key = JSON.stringify(card);
    let png = renders.get(key);
    if (!png) {
      png = renderInviteCard(card);
      png.catch(() => renders.delete(key));
      renders.set(key, png);
      if (renders.size > RENDER_CACHE_MAX) renders.delete(renders.keys().next().value!);
    }
    return png;
  }

  async function page(meta: Meta, title: string): Promise<Response> {
    const html = (await indexHtml())
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
      .replace("</head>", `  ${metaTags(meta)}\n  </head>`);
    // Presence changes by the minute; never let a CDN or browser pin a stale preview.
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  }

  const genericMeta = (req: Request): Meta => ({
    title: "HypeMeet",
    description: "Chamada de voz e vídeo pra galera. Sem conta, é só mandar o link.",
    url: `${publicOrigin(req)}${new URL(req.url).pathname}`,
    image: `${publicOrigin(req)}/og.png`,
    imageAlt: "HypeMeet — chamada de voz e vídeo pra galera",
  });

  const png = (body: Uint8Array) =>
    new Response(body, { headers: { "content-type": "image/png", "cache-control": "public, max-age=300" } });

  return {
    /** index.html with the generic card, for every SPA route that isn't a room. */
    async homePage(req: Request): Promise<Response> {
      return page(genericMeta(req), "HypeMeet");
    },

    async roomPage(req: Request, code: string): Promise<Response> {
      const room = opts.findRoom(code);
      if (!room) return page(genericMeta(req), "HypeMeet");
      const people = await presence.people(room.code);
      const base = publicOrigin(req);
      // The version pins this snapshot: WhatsApp/Discord cache images by URL, so a new crowd
      // must mean a new URL or the old faces stick around.
      const version = Bun.hash(JSON.stringify([room.name, people])).toString(36);
      return page(
        {
          title: room.name,
          description: people.length ? `🔴 ${presenceLine(people)} agora. Entra aí!` : presenceLine(people),
          url: `${base}/r/${room.code}`,
          image: `${base}/r/${room.code}/og.png?v=${version}`,
          imageAlt: `Convite para a sala ${room.name} no HypeMeet`,
        },
        `${room.name} · HypeMeet`,
      );
    },

    async roomImage(code: string): Promise<Response> {
      const room = opts.findRoom(code);
      if (!room) return new Response("Sala não encontrada", { status: 404 });
      const people = await presence.people(room.code);
      return png(await render({ name: room.name, code: room.code, people }));
    },

    async homeImage(): Promise<Response> {
      return png(await render({ name: null }));
    },
  };
}
