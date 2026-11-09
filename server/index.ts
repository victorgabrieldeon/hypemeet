import { SQL, type BunRequest } from "bun";
import { AccessToken, ParticipantInfo_State, RoomServiceClient, TokenVerifier, TrackSource, type ParticipantInfo } from "livekit-server-sdk";
import { join } from "node:path";
import { createAccess, Denied, permsIn } from "./access";
import { createAuth } from "./auth";
import { importSqlite, openDatabase } from "./db";
import { createDiscord, DiscordError, guildIconUrl, type Channel, type DiscordUser, type Member } from "./discord";
import { createGateway } from "./gateway";
import { discordIdOf, isTransmitter, nicknameOf } from "./identity";
import { createPasses, passForToken } from "./pass";
import { canManageGuild, has, moderationOf, P, publishSources } from "./permissions";
import { createPlugins } from "./plugins";
import { createLinkPreviews, publicOrigin } from "./preview";
import { ChannelMismatch, NAME_MAX, openRoomStore, orderGuilds, parseGuildPrefs, type Room } from "./rooms";
import { createYouTubeRelay } from "./youtube";

const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 3001);
// The SQLite file of before Postgres, imported once (server/db.ts).
const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "..", "data", "hypemeet.db");
const DIST_DIR = join(import.meta.dir, "..", "dist");

// Dev defaults match `livekit-server --dev`. Production must be explicit: never ship the dev keys.
if (PRODUCTION) {
  const missing = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "DATABASE_URL"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing env in production: ${missing.join(", ")}`);
}
// Dev default: the postgres service of docker-compose.yml (`bun run db`).
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://hypemeet:hypemeet@localhost:5433/hypemeet";
// Unset in dev → null: the browser connects to its own origin and Vite proxies /rtc to LiveKit.
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? null;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "secret";
// Server → LiveKit API (presence). Defaults to the public URL; set it to skip the proxy (e.g. http://livekit:7880).
const LIVEKIT_HOST = process.env.LIVEKIT_HOST ?? LIVEKIT_URL ?? "http://localhost:7880";
const PRESENCE_MAX_ROOMS = 30;
// Where the site lives, for the "open outside Discord" link: inside the Activity the request comes
// through Discord's proxy, so its own host may not be the site's.
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/+$/, "") || null;
const siteOrigin = (req: Request) => PUBLIC_URL ?? publicOrigin(req);

const livekit = new RoomServiceClient(LIVEKIT_HOST, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const verifier = new TokenVerifier(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
// Participant attribute of a transmitter: a browser tab that only sends screens and a camera on behalf of someone
// already in the room (the Discord Activity can't capture the screen or the camera). Mirrors src/room/cast.ts.
// Anyone can set it on themselves: it counts only on a transmitter's identity (isTransmitter).
const CAST_FOR = "castFor";
// Participant attribute set by a moderator: deafened in the Discord call.
const DEAFENED = "deafened";
// Every id that goes into a Discord API path.
const SNOWFLAKE = /^\d{5,25}$/;
const ALL_SOURCES = [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
// What a transmitter may send, as the owner's token names them (the JWT carries source names, not numbers).
const CAST_SOURCES = [
  ["screen_share", TrackSource.SCREEN_SHARE],
  ["screen_share_audio", TrackSource.SCREEN_SHARE_AUDIO],
  ["camera", TrackSource.CAMERA],
] as const;
// Moderation in a Discord channel's room: the caller's Discord permission it takes, and the bot's (named as in Discord).
const MODERATION = {
  mute: { needs: P.MUTE_MEMBERS, bot: "Silenciar membros" },
  unmute: { needs: P.MUTE_MEMBERS, bot: "Silenciar membros" },
  deafen: { needs: P.DEAFEN_MEMBERS, bot: "Ensurdecer membros" },
  undeafen: { needs: P.DEAFEN_MEMBERS, bot: "Ensurdecer membros" },
  disconnect: { needs: P.MOVE_MEMBERS, bot: "Mover membros" },
} as const;

const sql = await openDatabase(DATABASE_URL);
await importSqlite(sql, DB_PATH);
const rooms = openRoomStore(sql);
const previews = createLinkPreviews({ distDir: DIST_DIR, livekit, findRoom: rooms.get });
const discord = createDiscord();
// Connects as soon as it's made: once per process, never per request.
const gateway = process.env.DISCORD_BOT_TOKEN ? createGateway({ token: process.env.DISCORD_BOT_TOKEN, forget: discord.forget }) : null;
const access = createAccess(discord, gateway ?? undefined);
const auth = createAuth({ sql, discord, origin: siteOrigin });
const plugins = createPlugins((process.env.PLUGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const youtube = createYouTubeRelay();
const passes = createPasses(LIVEKIT_API_SECRET);

const json = (body: unknown, status = 200) => Response.json(body, { status });
const error = (message: string, status: number) => json({ error: message }, status);
const INTERNAL = "Deu um erro no servidor, tente de novo";

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

/**
 * A LiveKit grant for one connection. `attributes` start on the participant (e.g. the Discord avatar).
 * `discordId` goes into the identity; `perms`, their Discord permissions in the channel, narrow what they may publish.
 */
async function joinGrant(room: Room, nickname: string, opts: { discordId?: string; attributes?: Record<string, string>; perms?: bigint | null } = {}) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    // Identity must be unique per connection: the same person may open several tabs.
    identity: `${nickname}#${crypto.randomUUID().slice(0, 8)}${opts.discordId ? `.${opts.discordId}` : ""}`,
    name: nickname,
    ttl: "6h",
    attributes: opts.attributes,
  });
  const sources = opts.perms == null ? null : publishSources(opts.perms);
  token.addGrant({
    room: room.code,
    roomJoin: true,
    // An empty source list means every source, so "none" has to be canPublish: false.
    canPublish: sources === null || sources.length > 0,
    ...(sources?.length ? { canPublishSources: sources } : {}),
    canSubscribe: true,
    canPublishData: true,
    // Participant attributes carry shared state (the watch party lives on its host's).
    canUpdateOwnMetadata: true,
  });
  return { token: await token.toJwt(), url: LIVEKIT_URL, room, ...(opts.perms != null ? { moderation: moderationOf(opts.perms) } : {}) };
}

const avatarOf = (user: { avatarUrl: string | null }): Record<string, string> => (user.avatarUrl ? { avatar: user.avatarUrl } : {});

/**
 * A Discord user's grant for a server channel's room. Muted there by a moderator (room_mutes) or server-muted in Discord:
 * no microphone, even after a reload. Server-deafened: marked so from the start.
 */
async function channelJoin(room: Room, user: DiscordUser, granted: { perms: bigint | null; member: Member | null } | null) {
  const perms = granted?.perms ?? null;
  return joinGrant(room, cleanText(user.name, 32) || "Discord", {
    discordId: user.id,
    attributes: { ...avatarOf(user), ...(granted?.member?.deaf ? { [DEAFENED]: "1" } : {}) },
    perms: perms !== null && (granted?.member?.mute || (await rooms.isMuted(room.code, user.id))) ? perms & ~P.SPEAK : perms,
  });
}

/** A refusal keeps its message; the database failing is ours; anything else is Discord (or LiveKit) failing. */
function failure(err: unknown, what: string): Response {
  if (err instanceof Denied) return error(err.message, err.status);
  if (err instanceof ChannelMismatch) return error("Canal inválido", 403);
  console.error(`${what} failed:`, err);
  if (err instanceof SQL.SQLError) return error(INTERNAL, 500);
  return error("O Discord não respondeu, tente de novo", 502);
}

/** failure() for a call made with the signed-in person's token: Discord turning it down (revoked) ends their session. */
async function sessionFailure(req: BunRequest, err: unknown, what: string): Promise<Response> {
  if (!(err instanceof DiscordError && err.status === 401 && err.userToken && (await auth.revoked(req)))) return failure(err, what);
  return error("Entre com o Discord", 401);
}

/** Who's in each room right now (transmitters left out), keyed by code. Rooms with nobody inside are omitted. */
async function presenceIn(codes: string[]): Promise<Record<string, { identity: string; name: string; avatar?: string }[]>> {
  if (!codes.length) return {};
  // One call finds the live rooms; participants are only fetched for those with someone inside.
  const live = (await livekit.listRooms(codes)).filter((r) => r.numParticipants > 0);
  const entries = await Promise.all(
    live.map(async (r) => {
      const people = (await livekit.listParticipants(r.name))
        .filter((p) => p.state !== ParticipantInfo_State.DISCONNECTED && !isTransmitter(p.identity))
        .sort((a, b) => Number(a.joinedAt - b.joinedAt))
        .map((p) => {
          const id = discordIdOf(p.identity);
          return {
            identity: p.identity,
            name: nicknameOf(p.identity, p.name),
            // Attributes are client-writable: only their own avatar on Discord's CDN gets through.
            ...(id && p.attributes.avatar?.startsWith(`https://cdn.discordapp.com/avatars/${id}/`) ? { avatar: p.attributes.avatar } : {}),
          };
        });
      return [r.name, people] as const;
    }),
  );
  return Object.fromEntries(entries.filter(([, people]) => people.length));
}

/** A room token's claims and room, for someone in it (not a transmitter); null when it's no such thing. */
async function roomToken(token: unknown) {
  const claims = typeof token === "string" && token ? await verifier.verify(token).catch(() => null) : null;
  const room = claims?.sub && claims.video?.room ? await rooms.get(claims.video.room) : null;
  return claims?.sub && room && !isTransmitter(claims.sub) ? { claims, sub: claims.sub, room } : null;
}

/** For moderation and invites: the caller's room, its Discord channel and their permissions there (as of ≤ 30 s ago). */
async function discordCaller(token: unknown) {
  const t = await roomToken(token);
  if (!t) return error("Entrada na sala inválida", 401);
  const link = t.room.discord;
  const callerId = discordIdOf(t.sub);
  if (!link || !callerId) return error("Isso só existe nos canais de servidores do Discord", 403);
  if (!(await discord.botGuildIds()).has(link.guildId)) return error("O HypeMeet não está neste servidor do Discord", 403);
  const found = await access.perms(link.guildId, link.channelId, callerId);
  return { ...t, link, perms: found?.perms ?? 0n };
}

/** Takes the microphone out of someone's publish permission (and mutes the one they're sending), or puts it back. */
async function setMicrophone(code: string, p: ParticipantInfo, allowed: boolean) {
  // updateParticipant replaces the whole permission: start from the current one.
  const permission = p.permission?.clone();
  if (!permission) throw new Error(`${p.identity} has no permission`);
  // An empty list with canPublish means every source.
  const current = !permission.canPublish ? [] : permission.canPublishSources.length ? permission.canPublishSources : ALL_SOURCES;
  const sources = [...current.filter((s) => s !== TrackSource.MICROPHONE), ...(allowed ? [TrackSource.MICROPHONE] : [])];
  permission.canPublish = sources.length > 0;
  permission.canPublishSources = sources;
  await livekit.updateParticipant(code, p.identity, { permission });
  if (!allowed)
    await Promise.all(
      p.tracks.filter((t) => t.source === TrackSource.MICROPHONE).map((t) => livekit.mutePublishedTrack(code, p.identity, t.sid, true)),
    );
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
        return json(await rooms.create(name), 201);
      },
    },
    "/api/rooms/:code": {
      async GET(req) {
        const room = await rooms.get(req.params.code);
        return room ? json(room) : error("Sala não encontrada", 404);
      },
    },
    // Who is in each room right now, keyed by code. Rooms with nobody inside are omitted, and so are Discord
    // servers' channels: who's in those is only for the server's members (/api/discord/guilds/:guild/channels).
    "/api/presence": {
      async GET(req) {
        // Capped before the lookups (the site sends at most 30 saved rooms): each one is a query.
        const asked = [...new Set((new URL(req.url).searchParams.get("codes") ?? "").split(","))].slice(0, PRESENCE_MAX_ROOMS);
        const found = await Promise.all(asked.map((c) => rooms.get(c)));
        const codes = [...new Set(found.filter((r) => !!r && !r.discord).map((r) => r!.code))];
        try {
          return json(await presenceIn(codes));
        } catch (err) {
          console.error("presence lookup failed:", err);
          return error("LiveKit indisponível", 502);
        }
      },
    },
    "/api/token": {
      async POST(req) {
        const body = await readJson(req);
        const room = await rooms.get(typeof body?.code === "string" ? body.code : "");
        if (!room) return error("Sala não encontrada", 404);
        // A Discord server's channel: whoever is signed in, as their Discord self, if the channel lets them in.
        if (room.discord) {
          const session = await auth.signedIn(req);
          if (!session) return error("Entre com o Discord para entrar neste canal", 401);
          const { user } = session;
          try {
            const granted = await access.check({ id: user.id, accessToken: session.accessToken }, room.discord.guildId, room.discord.channelId);
            return json(await channelJoin(room, user, granted));
          } catch (err) {
            return sessionFailure(req, err, "channel access");
          }
        }
        const nickname = cleanText(body?.nickname, 32);
        if (!nickname) return error("Escolha um apelido", 400);
        return json(await joinGrant(room, nickname));
      },
    },
    // Discord login on the site (server/auth.ts).
    "/api/me": { GET: (req) => auth.me(req) },
    "/api/auth/discord": { GET: (req) => auth.login(req) },
    "/api/auth/discord/callback": { GET: (req) => auth.callback(req) },
    "/api/auth/logout": { POST: (req) => auth.logout(req) },
    // The signed-in person's Discord servers, in the order they arranged (orderGuilds).
    "/api/discord/guilds": {
      async GET(req) {
        const session = await auth.signedIn(req);
        if (!session) return error("Entre com o Discord", 401);
        try {
          const [list, botIds, withRooms, prefs] = await Promise.all([
            discord.userGuilds(session.user.id, session.accessToken),
            discord.botGuildIds(),
            rooms.guildsWithRooms(),
            rooms.guildPrefs(session.user.id),
          ]);
          const guilds = list.map((g) => {
            const bot = botIds.has(g.id);
            return {
              id: g.id,
              name: g.name,
              iconUrl: guildIconUrl(g),
              bot,
              rooms: withRooms.has(g.id),
              addUrl: discord.bot && !bot && canManageGuild(g) ? discord.botInviteUrl(g.id) : null,
            };
          });
          return json(orderGuilds(guilds, prefs));
        } catch (err) {
          return sessionFailure(req, err, "discord guilds");
        }
      },
    },
    "/api/discord/guilds/prefs": {
      async PUT(req) {
        const session = await auth.signedIn(req);
        if (!session) return error("Entre com o Discord", 401);
        const prefs = parseGuildPrefs(await readJson(req));
        if (!prefs) return error("Pedido inválido", 400);
        try {
          await rooms.setGuildPrefs(session.user.id, prefs);
          return json({ ok: true });
        } catch (err) {
          return failure(err, "guild prefs");
        }
      },
    },
    // A server's voice channels the person can see, in Discord's order, with who's in each one's room.
    "/api/discord/guilds/:guild/channels": {
      async GET(req) {
        const session = await auth.signedIn(req);
        if (!session) return error("Entre com o Discord", 401);
        const guildId = req.params.guild;
        if (!SNOWFLAKE.test(guildId)) return error("Servidor não encontrado", 404);
        try {
          if (!(await discord.botGuildIds()).has(guildId)) return error("O HypeMeet não está neste servidor do Discord", 404);
          const [guild, list, member] = await Promise.all([discord.guild(guildId), discord.channels(guildId), discord.member(guildId, session.user.id)]);
          if (!member) return error("Você não está neste servidor do Discord", 403);
          const voice = list
            .filter((c) => c.type === 2)
            .map((channel) => ({ channel, perms: permsIn(guild, session.user.id, member, channel) }))
            .filter((v) => has(v.perms, P.VIEW_CHANNEL));
          const codes = await rooms.codesFor(guildId, voice.map((v) => v.channel.id));
          const present = await presenceIn([...codes.values()]).catch((err) => {
            console.error("presence lookup failed:", err);
            return {} as Awaited<ReturnType<typeof presenceIn>>;
          });
          const byPosition = (a: Channel, b: Channel) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
          const categories = list.filter((c) => c.type === 4).sort(byPosition);
          const listed = new Set(categories.map((c) => c.id));
          const childrenOf = (parent: string | null) =>
            voice
              // A category the bot can't see: its channels go with the uncategorised ones.
              .filter((v) => (v.channel.parent_id && listed.has(v.channel.parent_id) ? v.channel.parent_id : null) === parent)
              .sort((a, b) => byPosition(a.channel, b.channel))
              .map(({ channel, perms }) => {
                const code = codes.get(channel.id) ?? null;
                const here = (code && present[code]) || [];
                const roomIds = new Set(here.map((p) => discordIdOf(p.identity)));
                // [] while the Gateway is down or hasn't loaded this server: the client then shows the room only.
                const inCall = gateway?.voiceMembers(guildId, channel.id) ?? [];
                const callIds = new Set(inCall.map((m) => m.id));
                return {
                  kind: "voice" as const,
                  id: channel.id,
                  name: channel.name,
                  canConnect: has(perms, P.VIEW_CHANNEL | P.CONNECT),
                  code,
                  voice: inCall.map((m) => ({ ...m, inRoom: roomIds.has(m.id) })),
                  // Guests have no Discord id, so they always stay here.
                  people: here.filter((p) => !callIds.has(discordIdOf(p.identity) ?? "")),
                };
              });
          const items = [
            ...childrenOf(null),
            ...categories.flatMap((c) => {
              const children = childrenOf(c.id);
              return children.length ? [{ kind: "category" as const, id: c.id, name: c.name }, ...children] : [];
            }),
          ];
          return json({ guild: { id: guild.id, name: guild.name, iconUrl: guildIconUrl(guild) }, items });
        } catch (err) {
          return failure(err, "discord channels");
        }
      },
    },
    // A server voice channel's room, created on first use; then it's joined at /r/<code> like any other.
    "/api/discord/guilds/:guild/channels/:channel/room": {
      async POST(req) {
        const session = await auth.signedIn(req);
        if (!session) return error("Entre com o Discord", 401);
        const { guild: guildId, channel: channelId } = req.params;
        if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) return error("Canal inválido", 400);
        try {
          const { channel, verified } = await access.check({ id: session.user.id, accessToken: session.accessToken }, guildId, channelId);
          return json(await rooms.forDiscordChannel(channelId, (channel && cleanText(channel.name, NAME_MAX)) || null, guildId, verified));
        } catch (err) {
          return sessionFailure(req, err, "channel room");
        }
      },
    },
    // Discord Activity sign-in, step 1: the code from the SDK's `authorize` → the access token its
    // `authenticate` takes. Exchanging needs the client secret, so it happens here.
    "/api/discord/token": {
      async POST(req) {
        if (!discord.enabled) return error("A atividade do Discord não está configurada no servidor", 503);
        const body = await readJson(req);
        if (typeof body?.code !== "string" || !body.code) return error("Pedido inválido", 400);
        try {
          return json({ accessToken: (await discord.exchangeCode(body.code)).accessToken });
        } catch (err) {
          console.error("discord token exchange failed:", err);
          return error("O Discord não confirmou o login", 401);
        }
      },
    },
    // Step 2: who the token belongs to (their Discord name and avatar) and a grant for the room of the
    // voice channel the Activity was opened in. In a server (guildId) the channel's permissions apply.
    "/api/discord/join": {
      async POST(req) {
        if (!discord.enabled) return error("A atividade do Discord não está configurada no servidor", 503);
        const body = await readJson(req);
        const accessToken = typeof body?.accessToken === "string" ? body.accessToken : "";
        const channelId = cleanText(body?.channelId, 32);
        const guildId = typeof body?.guildId === "string" ? body.guildId : null;
        if (!accessToken || !SNOWFLAKE.test(channelId) || (guildId !== null && !SNOWFLAKE.test(guildId))) return error("Pedido inválido", 400);
        let user;
        try {
          user = await discord.user(accessToken);
        } catch (err) {
          console.error("discord user lookup failed:", err);
          return error("O Discord não confirmou o login", 401);
        }
        try {
          const granted = guildId ? await access.check({ id: user.id, accessToken }, guildId, channelId) : null;
          // The bot's name for the channel when it has one; the Activity's otherwise.
          const name = cleanText(granted?.channel?.name ?? body?.channelName, NAME_MAX) || "Discord";
          // Without a guild id (a DM), a server channel's room refuses: that's ChannelMismatch.
          const room = await rooms.forDiscordChannel(channelId, name, guildId, granted?.verified ?? false);
          const grant = await channelJoin(room, user, granted);
          return json({ ...grant, webUrl: `${siteOrigin(req)}/r/${room.code}` });
        } catch (err) {
          return failure(err, "discord join");
        }
      },
    },
    // Moderation in a Discord channel's room, by someone whose Discord permissions in that channel allow it: in the
    // room, and in the Discord call too when the target is in it (through the bot).
    "/api/moderate": {
      async POST(req) {
        const body = await readJson(req);
        const action = typeof body?.action === "string" && Object.hasOwn(MODERATION, body.action) ? (body.action as keyof typeof MODERATION) : null;
        const identity = typeof body?.identity === "string" ? body.identity : "";
        if (!action || !identity) return error("Pedido inválido", 400);
        try {
          const caller = await discordCaller(body?.token);
          if (caller instanceof Response) return caller;
          if (!has(caller.perms, MODERATION[action].needs)) return error("Você não tem permissão para isso no Discord", 403);
          if (identity === caller.sub) return error("Isso não dá pra fazer com você mesmo", 400);
          const { link, room } = caller;
          const target = await livekit.getParticipant(room.code, identity).catch(() => null);
          if (!target) return error("Essa pessoa não está mais na sala", 404);
          const name = nicknameOf(target.identity, target.name);
          const targetId = discordIdOf(target.identity);
          const inCall = !!targetId && (await access.voiceChannel(link.guildId, targetId)) === link.channelId;
          // The token's name is whatever the caller set on themselves; the identity's is the server's.
          const reason = `HypeMeet: ${nicknameOf(caller.sub)}`;
          /** Every connection of the target's Discord account in the room (their other tabs, the Activity). */
          const connections = async () =>
            targetId
              ? (await livekit.listParticipants(room.code)).filter((p) => p.state !== ParticipantInfo_State.DISCONNECTED && discordIdOf(p.identity) === targetId)
              : [target];
          /** The Discord half, only when they're in this channel's call: its failure names the bot permission missing. */
          const inDiscord = async (change: { mute?: boolean; deaf?: boolean; channel_id?: null }) => {
            if (!inCall) return json({ ok: true });
            try {
              await discord.editMember(link.guildId, targetId!, change, reason);
              return json({ ok: true });
            } catch (err) {
              console.error(`discord ${action} failed:`, err);
              return error(`No Discord não deu: o bot do HypeMeet precisa de "${MODERATION[action].bot}" no canal`, 502);
            }
          };
          switch (action) {
            case "mute":
              // Stored, so their next join comes in muted too.
              if (targetId) await rooms.setMuted(room.code, targetId, true);
              await Promise.all((await connections()).map((p) => setMicrophone(room.code, p, false)));
              return inDiscord({ mute: true });
            case "unmute": {
              const res = await inDiscord({ mute: false });
              if (!res.ok) return res;
              if (targetId) await rooms.setMuted(room.code, targetId, false);
              // Back only for who may speak in the channel at all.
              const theirs = targetId ? await access.perms(link.guildId, link.channelId, targetId) : null;
              if (!theirs || !has(theirs.perms, P.SPEAK)) return error(`${name} não tem permissão para falar neste canal do Discord`, 409);
              await Promise.all((await connections()).map((p) => setMicrophone(room.code, p, true)));
              return res;
            }
            case "deafen":
            case "undeafen": {
              if (!inCall) return error(`${name} não está na call do Discord`, 409);
              const res = await inDiscord({ deaf: action === "deafen" });
              if (res.ok) await livekit.updateParticipant(room.code, identity, { attributes: { [DEAFENED]: action === "deafen" ? "1" : "" } });
              return res;
            }
            case "disconnect": {
              const transmitters = (await livekit.listParticipants(room.code)).filter((p) => {
                const owner = isTransmitter(p.identity) ? p.attributes[CAST_FOR] : undefined;
                // Their earlier connections' too: a link minted before a kick can still be opened.
                return !!owner && (owner === identity || (!!targetId && discordIdOf(owner) === targetId));
              });
              await Promise.all([target, ...transmitters].map((p) => livekit.removeParticipant(room.code, p.identity)));
              return inDiscord({ channel_id: null });
            }
          }
        } catch (err) {
          return failure(err, "moderation");
        }
      },
    },
    // A discord.gg invite that opens the HypeMeet Activity in the room's voice channel.
    "/api/discord/invite": {
      async POST(req) {
        const body = await readJson(req);
        try {
          const caller = await discordCaller(body?.token);
          if (caller instanceof Response) return caller;
          if (!has(caller.perms, P.CREATE_INSTANT_INVITE)) return error("Você não pode criar convites neste canal do Discord", 403);
          try {
            return json({ url: await discord.activityInvite(caller.link.channelId) });
          } catch (err) {
            console.error("discord invite failed:", err);
            return error('O Discord não criou o convite (o bot precisa de "Criar convite" no canal)', 502);
          }
        } catch (err) {
          return failure(err, "discord invite");
        }
      },
    },
    // A transmitter link for someone in a room: proven by their own room token, it lets a browser tab
    // send screens and a camera that show up as theirs. The grant rides in the URL fragment, which never
    // reaches a server.
    "/api/cast": {
      async POST(req) {
        const body = await readJson(req);
        const t = await roomToken(body?.token);
        if (!t) return error("Entrada na sala inválida", 401);
        const { claims, room } = t;
        // Only while they're in the room: a token outlives a disconnect by a moderator.
        if (!(await livekit.getParticipant(room.code, t.sub).catch(() => null))) return error("Entrada na sala inválida", 401);
        // Never more than the owner may send: a Discord channel without "Vídeo" gets no transmitter.
        const owner = claims.video?.canPublishSources as unknown as string[] | undefined;
        const sources =
          claims.video?.canPublish === false ? [] : CAST_SOURCES.filter(([source]) => !owner?.length || owner.includes(source)).map(([, s]) => s);
        if (!sources.length) return error("Você não tem permissão de vídeo neste canal", 403);
        const name = nicknameOf(t.sub, claims.name);
        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
          identity: `${name}#tx-${crypto.randomUUID().slice(0, 8)}`,
          name,
          // Only to open the link; LiveKit renews the token of whoever is connected.
          ttl: "15m",
          attributes: { [CAST_FOR]: t.sub },
        });
        token.addGrant({
          room: room.code,
          roomJoin: true,
          canPublish: true,
          canPublishSources: sources,
          // Never subscribes to anything; this is what delivers the owner's "stop" messages.
          canSubscribe: true,
          // Screen previews and the owner's controls ride the data channel.
          canPublishData: true,
          canUpdateOwnMetadata: false,
        });
        const fragment = new URLSearchParams({ t: await token.toJwt(), ...(LIVEKIT_URL ? { u: LIVEKIT_URL } : {}) });
        return json({ url: `${siteOrigin(req)}/transmitir#${fragment}` });
      },
    },
    // Plugins the room can open (sdk/hypemeet-plugin.ts).
    "/api/plugins": {
      async GET() {
        const list = await plugins.list();
        // None answered yet (still booting?): an error, so rooms ask again; no plugins at all is just [].
        return list.length || !plugins.configured ? json(list) : error("Plugins indisponíveis", 503);
      },
    },
    // A pass for a plugin that asks for one (server/pass.ts), for whoever holds a room token.
    "/api/plugins/:id/pass": {
      async POST(req) {
        const plugin = (await plugins.list()).find((p) => p.id === req.params.id && p.pass);
        if (!plugin) return error("Plugin não encontrado", 404);
        const body = await readJson(req);
        const pass = await passForToken(body?.token, plugin.id, { verify: (t) => verifier.verify(t), roomExists: async (c) => !!(await rooms.get(c)), passes });
        return pass ? json({ pass }) : error("Entrada na sala inválida", 401);
      },
    },
    // A plugin's server asking who holds a pass: { plugin, id, name, exp }. It checks `plugin` is itself.
    "/api/plugins/pass": {
      async POST(req) {
        const body = await readJson(req);
        const pass = typeof body?.pass === "string" ? await passes.verify(body.pass) : null;
        return pass ? json(pass) : error("Passe inválido", 401);
      },
    },
    // YouTube relayed for the Discord Activity (server/youtube.ts). Only for someone signed in with Discord (anyone
    // gets a room token; the identity, not the token's client-set attributes, says who): `t` is their token, in the
    // query because a <video> can't send headers.
    "/api/youtube/:id": {
      async GET(req) {
        const t = new URL(req.url).searchParams.get("t");
        const claims = t ? await verifier.verify(t).catch(() => null) : null;
        if (!claims?.sub || !discordIdOf(claims.sub) || !claims.video?.room || !(await rooms.get(claims.video.room)))
          return error("Entrada na sala inválida", 401);
        if (!/^[\w-]{11}$/.test(req.params.id)) return error("Vídeo inválido", 400);
        return youtube.stream(req.params.id, req);
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
  // Whatever a route didn't catch (the database down, mostly): a plain 500, never the error itself.
  error(err) {
    console.error("request failed:", err);
    return error(INTERNAL, 500);
  },
});

console.log(`hypemeet api on http://localhost:${PORT} (livekit: ${LIVEKIT_URL ?? "same origin via /rtc proxy"})`);
