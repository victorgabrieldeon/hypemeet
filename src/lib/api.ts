/** The Discord server voice channel a room belongs to. */
export interface DiscordLink {
  guildId: string;
  channelId: string;
}

export interface RoomInfo {
  code: string;
  name: string;
  createdAt: number;
  /**
   * A server voice channel's room: joining goes through Discord (login plus the channel's permissions).
   * Null for groups (rooms made here), DM Activities and old channel rooms whose server isn't known yet.
   */
  discord: DiscordLink | null;
}

/** What someone may do to others in a Discord channel's room, from their own permissions in that channel. */
export interface Moderation {
  /** MUTE_MEMBERS */
  mute: boolean;
  /** DEAFEN_MEMBERS */
  deafen: boolean;
  /** MOVE_MEMBERS */
  disconnect: boolean;
  /** CREATE_INSTANT_INVITE */
  invite: boolean;
}

export type ModerationAction = "mute" | "unmute" | "deafen" | "undeafen" | "disconnect";

export interface JoinGrant {
  token: string;
  /** null → LiveKit is reachable on this page's own origin (dev proxy). */
  url: string | null;
  room: RoomInfo;
  /** Only in a Discord channel's room whose server has the HypeMeet bot (permissions are known). */
  moderation?: Moderation;
}

/** Joining from the Discord Activity: also carries the room's address on the open web. */
export interface DiscordGrant extends JoinGrant {
  webUrl: string;
}

export interface PresentPerson {
  identity: string;
  name: string;
  /** Discord avatar (only cdn.discordapp.com/avatars/… URLs get through). */
  avatar?: string;
}

/** Whoever is signed in on this site with Discord. */
export interface Me {
  id: string;
  /** Display name (global name), falling back to the username. */
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface Session {
  user: Me | null;
  /** Discord login is configured on the server. */
  login: boolean;
}

/** One of the signed-in person's Discord servers. */
export interface Guild {
  id: string;
  name: string;
  iconUrl: string | null;
  /** The HypeMeet bot is in it, so its voice channels can be listed. */
  bot: boolean;
  /** HypeMeet already has rooms for its channels. The rail lists servers with the bot or rooms. */
  rooms: boolean;
  /** Pinned at the top of the rail by this person. */
  favorite: boolean;
  /** Link that adds the bot to this server, when it's missing and you can add it (owner, admin or Manage Server). */
  addUrl: string | null;
}

/** A server's voice channels in Discord's order, categories inline. Only channels you can see. */
export type ChannelListItem =
  | { kind: "category"; id: string; name: string }
  | {
      kind: "voice";
      id: string;
      name: string;
      /** VIEW_CHANNEL + CONNECT: may open its room. */
      canConnect: boolean;
      /** Its room, once someone has opened it. */
      code: string | null;
      /** Who is in the Discord call (from the bot's Gateway connection; empty while it's down). */
      voice: VoiceMember[];
      /** Who is in its HypeMeet room right now and NOT in `voice` (site-only people). */
      people: PresentPerson[];
    };

/** Someone in a Discord voice channel. */
export interface VoiceMember {
  /** Discord user id. */
  id: string;
  name: string;
  /** cdn.discordapp.com avatar (guild avatar when set). */
  avatar?: string;
  /** Muted (server or self). */
  mute: boolean;
  /** Deafened (server or self). */
  deaf: boolean;
  /** Also in the channel's HypeMeet room. */
  inRoom: boolean;
}

export interface GuildChannels {
  guild: { id: string; name: string; iconUrl: string | null };
  items: ChannelListItem[];
}

/** A plugin the room can open (server/plugins.ts). */
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  url: string;
  /** Opens with ?pass=<pass> on its address (server/pass.ts). */
  pass?: true;
}

/** Room code → people connected right now. Empty rooms are absent. */
export type Presence = Record<string, PresentPerson[]>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Erro ${res.status}`, res.status);
  return body as T;
}

export const api = {
  createRoom: (name: string) =>
    request<RoomInfo>("/api/rooms", { method: "POST", body: JSON.stringify({ name }) }),
  getRoom: (code: string) => request<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`),
  presence: (codes: string[]) => request<Presence>(`/api/presence?codes=${codes.map(encodeURIComponent).join(",")}`),
  /** In a Discord channel's room the nickname is ignored: the server uses the session's Discord account. */
  joinRoom: (code: string, nickname: string) =>
    request<JoinGrant>("/api/token", { method: "POST", body: JSON.stringify({ code, nickname }) }),
  /** A browser-transmitter link for whoever holds this room token (see room/cast.ts). */
  castLink: (token: string) => request<{ url: string }>("/api/cast", { method: "POST", body: JSON.stringify({ token }) }),
  plugins: () => request<PluginInfo[]>("/api/plugins"),
  /** A pass to this plugin (server/pass.ts), for whoever holds this room token. */
  pluginPass: (id: string, token: string) =>
    request<{ pass: string }>(`/api/plugins/${encodeURIComponent(id)}/pass`, { method: "POST", body: JSON.stringify({ token }) }),
  /** A YouTube video relayed by the server (server/youtube.ts), for a <video> in the Discord Activity. */
  youTubeStream: (videoId: string, token: string) => `/api/youtube/${videoId}?t=${encodeURIComponent(token)}`,
  discordToken: (code: string) =>
    request<{ accessToken: string }>("/api/discord/token", { method: "POST", body: JSON.stringify({ code }) }),
  discordJoin: (body: { accessToken: string; guildId: string | null; channelId: string; channelName: string | null }) =>
    request<DiscordGrant>("/api/discord/join", { method: "POST", body: JSON.stringify(body) }),

  // --- Discord on the site: login (session cookie), servers and their voice channels ---
  session: () => request<Session>("/api/me"),
  /** Full-page navigation target: Discord's consent screen, then back to `next` (a path on this site). */
  loginUrl: (next: string) => `/api/auth/discord?next=${encodeURIComponent(next)}`,
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  /** Already in the person's order: favourites first. */
  guilds: () => request<Guild[]>("/api/discord/guilds"),
  saveGuildPrefs: (prefs: { order: string[]; favorites: string[] }) =>
    request<{ ok: true }>("/api/discord/guilds/prefs", { method: "PUT", body: JSON.stringify(prefs) }),
  guildChannels: (guildId: string) => request<GuildChannels>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channels`),
  /** The voice channel's room (created on first use); needs VIEW_CHANNEL + CONNECT. Then join it at /r/<code>. */
  channelRoom: (guildId: string, channelId: string) =>
    request<RoomInfo>(`/api/discord/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(channelId)}/room`, {
      method: "POST",
    }),
  /** Moderate someone in a Discord channel's room; checked against the caller's Discord permissions there. */
  moderate: (token: string, identity: string, action: ModerationAction) =>
    request<{ ok: true }>("/api/moderate", { method: "POST", body: JSON.stringify({ token, identity, action }) }),
  /** A discord.gg invite that opens the HypeMeet Activity in this room's voice channel (needs CREATE_INSTANT_INVITE). */
  discordInvite: (token: string) =>
    request<{ url: string }>("/api/discord/invite", { method: "POST", body: JSON.stringify({ token }) }),
};
