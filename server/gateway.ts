// The bot's Discord Gateway connection: who is in each voice channel of the servers the bot is in, and when a server's
// channels or roles change (so server/discord.ts drops its cached copy). Only with DISCORD_BOT_TOKEN; intents GUILDS
// and GUILD_VOICE_STATES, neither privileged. One connection per running server.

const GATEWAY = "wss://gateway.discord.gg";
const QUERY = "/?v=10&encoding=json";
/** GUILDS | GUILD_VOICE_STATES */
const INTENTS = (1 << 0) | (1 << 7);
const CDN = "https://cdn.discordapp.com";
// Closes no reconnect can fix: bad token, bad shard, sharding required, bad API version, bad or privileged intents.
const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
// Closes that end the session (invalid seq, session timed out): identify again instead of resuming.
const SESSION_GONE = new Set([4007, 4009]);

export interface VoiceState {
  channelId: string;
  /** Server mute / deafen (a moderator's). */
  mute: boolean;
  deaf: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  selfStream: boolean;
  selfVideo: boolean;
  suppress: boolean;
}

/** Someone in voice as that server shows them; avatar 64 px, the server one first, null → Discord's default. */
export interface Person {
  name: string;
  avatar: string | null;
}

export interface GuildState {
  /** Discord has an outage there: the bot is still in it, but what's kept may be stale. */
  unavailable: boolean;
  /** User id → their voice state; only people connected to a channel. */
  voice: Map<string, VoiceState>;
  /** User id → display info, for the people in `voice` only. */
  people: Map<string, Person>;
}

/** Guild id → its state, for every server the bot is in. */
export type GatewayState = Map<string, GuildState>;

/** A cache entry of server/discord.ts an event made stale. */
export interface Stale {
  cache: "channels" | "guild" | "botGuilds";
  guildId: string;
}

/** src/lib/api.ts's VoiceMember without `inRoom`, which only the room's presence knows. */
export interface VoiceMember {
  id: string;
  name: string;
  avatar?: string;
  /** Server or self. */
  mute: boolean;
  deaf: boolean;
}

// Discord's payloads, only the fields read here.
interface RawUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}
interface RawMember {
  user: RawUser;
  nick?: string | null;
  avatar?: string | null;
}
interface RawVoiceState {
  guild_id?: string;
  user_id: string;
  channel_id: string | null;
  member?: RawMember;
  mute: boolean;
  deaf: boolean;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream?: boolean;
  self_video: boolean;
  suppress: boolean;
}
interface RawGuild {
  id: string;
  unavailable?: boolean;
  voice_states?: RawVoiceState[];
  members?: RawMember[];
}

const voiceOf = (v: RawVoiceState, channelId: string): VoiceState => ({
  channelId,
  mute: v.mute,
  deaf: v.deaf,
  selfMute: v.self_mute,
  selfDeaf: v.self_deaf,
  selfStream: !!v.self_stream,
  selfVideo: v.self_video,
  suppress: v.suppress,
});

const personOf = (guildId: string, { user, nick, avatar }: RawMember): Person => ({
  name: nick || user.global_name || user.username,
  avatar: avatar
    ? `${CDN}/guilds/${guildId}/users/${user.id}/avatars/${avatar}.png?size=64`
    : user.avatar
      ? `${CDN}/avatars/${user.id}/${user.avatar}.png?size=64`
      : null,
});

const unavailableGuild = (): GuildState => ({ unavailable: true, voice: new Map(), people: new Map() });

/** Applies a dispatch (op 0) to the state. No I/O: the cache entry it made stale, if any, is returned. */
export function reduce(guilds: GatewayState, t: string, d: unknown): Stale | null {
  switch (t) {
    case "READY":
      // A new session: every server is sent again, one GUILD_CREATE each.
      guilds.clear();
      for (const g of (d as { guilds: { id: string }[] }).guilds) guilds.set(g.id, unavailableGuild());
      return null;
    case "GUILD_CREATE": {
      const g = d as RawGuild;
      const voice = new Map<string, VoiceState>();
      for (const v of g.voice_states ?? []) if (v.channel_id) voice.set(v.user_id, voiceOf(v, v.channel_id));
      // Members in voice come with it; small servers send everyone, who isn't kept.
      const people = new Map((g.members ?? []).filter((m) => voice.has(m.user.id)).map((m) => [m.user.id, personOf(g.id, m)]));
      guilds.set(g.id, { unavailable: false, voice, people });
      return { cache: "botGuilds", guildId: g.id };
    }
    case "GUILD_DELETE": {
      const g = d as RawGuild;
      // An outage keeps it (the bot is still in it); otherwise the bot was removed.
      if (g.unavailable) guilds.set(g.id, { ...(guilds.get(g.id) ?? unavailableGuild()), unavailable: true });
      else guilds.delete(g.id);
      return { cache: "botGuilds", guildId: g.id };
    }
    case "GUILD_UPDATE":
      return { cache: "guild", guildId: (d as RawGuild).id };
    case "GUILD_ROLE_CREATE":
    case "GUILD_ROLE_UPDATE":
    case "GUILD_ROLE_DELETE":
      return { cache: "guild", guildId: (d as { guild_id: string }).guild_id };
    case "CHANNEL_CREATE":
    case "CHANNEL_UPDATE":
    case "CHANNEL_DELETE": {
      const guildId = (d as { guild_id?: string }).guild_id;
      return guildId ? { cache: "channels", guildId } : null;
    }
    case "VOICE_STATE_UPDATE": {
      const v = d as RawVoiceState;
      const g = v.guild_id ? guilds.get(v.guild_id) : undefined;
      if (!g) return null;
      if (!v.channel_id) {
        g.voice.delete(v.user_id);
        g.people.delete(v.user_id);
      } else {
        g.voice.set(v.user_id, voiceOf(v, v.channel_id));
        if (v.member) g.people.set(v.user_id, personOf(v.guild_id!, v.member));
      }
      return null;
    }
  }
  return null;
}

export function createGateway({
  token,
  forget,
  WebSocket: Socket = WebSocket,
}: {
  token: string;
  /** server/discord.ts's `forget`. */
  forget: Record<Stale["cache"], (guildId: string) => void>;
  /** For tests. */
  WebSocket?: new (url: string) => WebSocket;
}) {
  const guilds: GatewayState = new Map();
  let ws: WebSocket | null = null;
  let seq: number | null = null;
  let session: { id: string; url: string } | null = null;
  // READY or RESUMED on the current connection: the state is current.
  let ready = false;
  let failures = 0;
  let acked = true;
  let beats: Timer | undefined;
  let retry: Timer | undefined;
  let stopped = false;

  const send = (op: number, d: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }));
  };

  function connect() {
    const socket = new Socket(`${session?.url ?? GATEWAY}${QUERY}`);
    ws = socket;
    // Bun follows every error with a close, so reconnecting only happens there. A late event of an old socket is ignored.
    socket.addEventListener("message", (e) => socket === ws && receive(JSON.parse(String(e.data))));
    socket.addEventListener("close", (e) => socket === ws && closed(e.code, e.reason));
  }

  /** Drops the connection and opens another after `ms`, resuming the session when there is one. */
  function reconnect(ms: number) {
    const old = ws;
    ws = null;
    ready = false;
    clearTimeout(beats); // also clears an interval
    // Not 1000/1001: those end the session on Discord's side.
    old?.close(4000);
    if (!stopped) retry = setTimeout(connect, ms);
  }

  function closed(code: number, reason: string) {
    if (FATAL.has(code)) {
      console.error(`discord gateway closed for good (${code} ${reason}): check the bot token and its intents`);
      return stop();
    }
    if (SESSION_GONE.has(code)) session = null;
    const ms = Math.min(1000 * 2 ** failures++, 60_000);
    console.warn(`discord gateway closed (${code}${reason ? ` ${reason}` : ""}), reconnecting in ${ms / 1000} s`);
    reconnect(ms);
  }

  function beat() {
    // No ack since the last beat: the connection died without closing.
    if (!acked) return reconnect(0);
    acked = false;
    send(1, seq);
  }

  function receive(p: { op: number; d: unknown; s?: number | null; t?: string | null }) {
    if (p.s != null) seq = p.s;
    switch (p.op) {
      case 0: {
        if (p.t === "READY") {
          const r = p.d as { session_id: string; resume_gateway_url: string };
          session = { id: r.session_id, url: r.resume_gateway_url };
        }
        if (p.t === "READY" || p.t === "RESUMED") {
          ready = true;
          failures = 0;
        }
        const stale = reduce(guilds, p.t ?? "", p.d);
        if (stale) forget[stale.cache](stale.guildId);
        return;
      }
      case 1:
        send(1, seq);
        return;
      case 7:
        // Discord asks for a new connection: resume there.
        return reconnect(0);
      case 9:
        // Invalid session; `d` true → it can still be resumed. Discord asks for a 1–5 s wait either way.
        if (!p.d) session = null;
        return reconnect(1000 + Math.random() * 4000);
      case 10: {
        const every = (p.d as { heartbeat_interval: number }).heartbeat_interval;
        acked = true;
        // The first beat somewhere in the first interval, as Discord asks (bots reconnecting at once don't beat together).
        beats = setTimeout(() => {
          beats = setInterval(beat, every);
          beat();
        }, every * Math.random());
        if (session) return send(6, { token, session_id: session.id, seq });
        seq = null;
        send(2, { token, intents: INTENTS, properties: { os: process.platform, browser: "hypemeet", device: "hypemeet" } });
        return;
      }
      case 11:
        acked = true;
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(retry);
    reconnect(0);
  }

  /** The Gateway has that server's state (connected, the bot is in it, no outage there): only then ask it. */
  const knows = (guildId: string) => ready && guilds.get(guildId)?.unavailable === false;

  connect();
  return {
    get connected() {
      return ready;
    },
    knows,

    /** The voice channel they're in there, or null; ask only when `knows(guildId)`. */
    voiceChannelOf: (guildId: string, userId: string): string | null => guilds.get(guildId)?.voice.get(userId)?.channelId ?? null,

    /** Who's in that voice channel's call, by name; [] when it doesn't know the server. */
    voiceMembers(guildId: string, channelId: string): VoiceMember[] {
      const g = guilds.get(guildId);
      if (!g || !knows(guildId)) return [];
      return [...g.voice]
        .filter(([, v]) => v.channelId === channelId)
        .map(([id, v]) => {
          const person = g.people.get(id);
          return {
            id,
            // shortcut: a voice state that came without its member has no name until their next update.
            name: person?.name ?? "Alguém",
            ...(person?.avatar ? { avatar: person.avatar } : {}),
            mute: v.mute || v.selfMute,
            deaf: v.deaf || v.selfDeaf,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },

    stop,
  };
}

export type Gateway = ReturnType<typeof createGateway>;
