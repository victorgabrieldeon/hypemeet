import { AccessToken, ParticipantInfo_State, RoomServiceClient } from "livekit-server-sdk";
import { join } from "node:path";
import { createLinkPreviews } from "./preview";
import { NAME_MAX, openRoomStore } from "./rooms";

const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "..", "data", "hypemeet.db");
const DIST_DIR = join(import.meta.dir, "..", "dist");

// Dev defaults match `livekit-server --dev`. Production must be explicit: never ship the dev keys.
if (PRODUCTION) {
  const missing = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing env in production: ${missing.join(", ")}`);
}
// Unset in dev → null: the browser connects to its own origin and Vite proxies /rtc to LiveKit.
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? null;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "secret";
// Server → LiveKit API (presence). Defaults to the public URL; set it to skip the proxy (e.g. http://livekit:7880).
const LIVEKIT_HOST = process.env.LIVEKIT_HOST ?? LIVEKIT_URL ?? "http://localhost:7880";
const PRESENCE_MAX_ROOMS = 30;

const livekit = new RoomServiceClient(LIVEKIT_HOST, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const rooms = openRoomStore(DB_PATH);
const previews = createLinkPreviews({ distDir: DIST_DIR, livekit, findRoom: rooms.get });

const json = (body: unknown, status = 200) => Response.json(body, { status });
const error = (message: string, status: number) => json({ error: message }, status);

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

async function serveStatic(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const file = Bun.file(join(DIST_DIR, pathname));
  // Path traversal guard: resolved path must stay inside dist.
  if (pathname !== "/" && !pathname.includes("..") && (await file.exists())) return new Response(file);
  return previews.homePage(req);
}

Bun.serve({
  port: PORT,
  routes: {
    "/api/rooms": {
      async POST(req) {
        const body = await readJson(req);
        const name = cleanText(body?.name, NAME_MAX);
        if (!name) return error("Dê um nome para a sala", 400);
        return json(rooms.create(name), 201);
      },
    },
    "/api/rooms/:code": {
      GET(req) {
        const room = rooms.get(req.params.code);
        return room ? json(room) : error("Sala não encontrada", 404);
      },
    },
    // Who is in each room right now, keyed by code. Rooms with nobody inside are omitted.
    "/api/presence": {
      async GET(req) {
        const codes = [
          ...new Set(
            (new URL(req.url).searchParams.get("codes") ?? "")
              .split(",")
              .map((c) => rooms.get(c)?.code)
              .filter((c): c is string => !!c),
          ),
        ].slice(0, PRESENCE_MAX_ROOMS);
        if (!codes.length) return json({});
        try {
          // One call finds the live rooms; participants are only fetched for those with someone inside.
          const live = (await livekit.listRooms(codes)).filter((r) => r.numParticipants > 0);
          const entries = await Promise.all(
            live.map(async (r) => {
              const people = (await livekit.listParticipants(r.name))
                .filter((p) => p.state !== ParticipantInfo_State.DISCONNECTED)
                .sort((a, b) => Number(a.joinedAt - b.joinedAt))
                .map((p) => ({ identity: p.identity, name: p.name || p.identity.split("#")[0] }));
              return [r.name, people] as const;
            }),
          );
          return json(Object.fromEntries(entries.filter(([, people]) => people.length)));
        } catch (err) {
          console.error("presence lookup failed:", err);
          return error("LiveKit indisponível", 502);
        }
      },
    },
    "/api/token": {
      async POST(req) {
        const body = await readJson(req);
        const room = rooms.get(typeof body?.code === "string" ? body.code : "");
        if (!room) return error("Sala não encontrada", 404);
        const nickname = cleanText(body?.nickname, 32);
        if (!nickname) return error("Escolha um apelido", 400);

        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
          // Identity must be unique per connection: the same person may open several tabs.
          identity: `${nickname}#${crypto.randomUUID().slice(0, 8)}`,
          name: nickname,
          ttl: "6h",
        });
        token.addGrant({
          room: room.code,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          // Participant attributes carry shared state (the watch party lives on its host's).
          canUpdateOwnMetadata: true,
        });
        return json({ token: await token.toJwt(), url: LIVEKIT_URL, room });
      },
    },
    "/api/*": () => error("Not found", 404),
    // Link previews (Open Graph). The images also work in dev, straight from this port.
    "/og.png": () => previews.homeImage(),
    "/r/:code/og.png": (req) => previews.roomImage(req.params.code),
    "/r/:code": (req) => (PRODUCTION ? previews.roomPage(req, req.params.code) : error("Not found", 404)),
  },
  fetch(req) {
    if (!PRODUCTION) return error("Not found", 404);
    return serveStatic(req);
  },
});

console.log(`hypemeet api on http://localhost:${PORT} (livekit: ${LIVEKIT_URL ?? "same origin via /rtc proxy"})`);
