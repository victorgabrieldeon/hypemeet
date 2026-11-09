// HypeMeet and Discord: the Activity (the page inside Discord's iframe signs in with the Embedded App SDK and lands
// in the room tied to its voice channel), login on the site, and, with the bot, the user's servers, their voice
// channels, permissions and moderation.
// Env: DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET (Developer Portal → OAuth2), without them it's all off;
// DISCORD_BOT_TOKEN (Bot) for everything that reads a server or acts in it.

import { P, type Overwrite, type Role } from "./permissions";

const API = "https://discord.com/api/v10";
const USER_AGENT = "DiscordBot (https://github.com/victorgabrieldeon/hypemeet, 1)";
/** VIEW_CHANNEL | CONNECT | CREATE_INSTANT_INVITE | MUTE_MEMBERS | DEAFEN_MEMBERS | MOVE_MEMBERS */
const BOT_PERMISSIONS = P.VIEW_CHANNEL | P.CONNECT | P.CREATE_INSTANT_INVITE | P.MUTE_MEMBERS | P.DEAFEN_MEMBERS | P.MOVE_MEMBERS;

export interface DiscordUser {
  id: string;
  /** Display name (global name), falling back to the username. */
  name: string;
  username: string;
  /** cdn.discordapp.com/avatars/…, which the Activity's CSP allows without a URL mapping. Null → default avatar. */
  avatarUrl: string | null;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds. */
  expiresIn: number;
}

/** A guild from /users/@me/guilds: `permissions` are the base ones (no channel overwrites). */
export interface PartialGuild {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
  permissions?: string;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  roles: Role[];
}

export interface Channel {
  id: string;
  /** 2 voice, 4 category */
  type: number;
  name: string;
  position: number;
  parent_id?: string | null;
  permission_overwrites?: Overwrite[];
}

export interface Member {
  roles: string[];
  communication_disabled_until?: string | null;
  /** Server mute / deafen, until a moderator undoes it. */
  mute?: boolean;
  deaf?: boolean;
}

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The call used the person's own (Bearer) token, not the bot's: a 401 then means they took it back. */
    readonly userToken = false,
  ) {
    super(message);
  }
}

export const guildIconUrl = (g: { id: string; icon: string | null }) =>
  g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null;

/** Promises kept for `ttlMs`, shared by concurrent callers; a failure is forgotten right away, `drop` forgets one. */
function cache<T>(ttlMs: number) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  const get = (key: string, load: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    for (const [k, e] of entries) if (now - e.at > ttlMs) entries.delete(k);
    const hit = entries.get(key);
    if (hit) return hit.value;
    const entry = { at: now, value: load() };
    entries.set(key, entry);
    entry.value.catch(() => entries.get(key) === entry && entries.delete(key));
    return entry.value;
  };
  return Object.assign(get, { drop: (key: string) => void entries.delete(key) });
}

export function createDiscord() {
  const clientId = process.env.DISCORD_CLIENT_ID ?? "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? "";
  const botToken = process.env.DISCORD_BOT_TOKEN ?? "";

  async function call<T>(path: string, auth: string, init: { method?: string; body?: unknown; reason?: string } = {}): Promise<T> {
    for (let retried = false; ; retried = true) {
      const res = await fetch(`${API}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: auth,
          "user-agent": USER_AGENT,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(init.reason ? { "x-audit-log-reason": encodeURIComponent(init.reason) } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      if (res.status === 429 && !retried) {
        const wait = Number(((await res.json().catch(() => null)) as { retry_after?: number } | null)?.retry_after);
        if (wait <= 2) {
          await Bun.sleep(wait * 1000);
          continue;
        }
      }
      if (!res.ok)
        throw new DiscordError(`discord ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status})`, res.status, auth.startsWith("Bearer "));
      return (res.status === 204 ? null : await res.json()) as T;
    }
  }
  const bot = <T>(path: string, init?: Parameters<typeof call>[2]) => call<T>(path, `Bot ${botToken}`, init);

  async function oauthToken(params: Record<string, string>): Promise<Tokens> {
    const res = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number } | null;
    if (!res.ok || !body?.access_token) throw new DiscordError(`discord ${params.grant_type} failed (${res.status})`, res.status);
    return { accessToken: body.access_token, refreshToken: body.refresh_token ?? "", expiresIn: body.expires_in ?? 0 };
  }

  const userGuilds = cache<PartialGuild[]>(60_000);
  const botGuilds = cache<Set<string>>(60_000);
  const guilds = cache<Guild>(60_000);
  const channels = cache<Channel[]>(30_000);
  const members = cache<Member | null>(30_000);

  return {
    /** What a Gateway event made stale (server/gateway.ts): the next call asks Discord again. */
    forget: {
      channels: (guildId: string) => channels.drop(guildId),
      guild: (guildId: string) => guilds.drop(guildId),
      botGuilds: () => botGuilds.drop(""),
    },

    enabled: !!(clientId && clientSecret),
    /** The bot token is set: servers can be read and moderated. */
    bot: !!(clientId && clientSecret && botToken),

    /** The site's login: Discord's consent screen, skipped when already granted (`prompt=none`). */
    authorizeUrl(redirectUri: string, state: string): string {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: "identify guilds",
        redirect_uri: redirectUri,
        state,
        prompt: "none",
      });
      return `https://discord.com/oauth2/authorize?${params}`;
    },

    /** Exchanges an OAuth code (the Activity's `authorize`, or the site's login with its `redirectUri`). */
    exchangeCode(code: string, redirectUri?: string): Promise<Tokens> {
      return oauthToken({ grant_type: "authorization_code", code, ...(redirectUri ? { redirect_uri: redirectUri } : {}) });
    },

    refresh(refreshToken: string): Promise<Tokens> {
      return oauthToken({ grant_type: "refresh_token", refresh_token: refreshToken });
    },

    async revoke(token: string): Promise<void> {
      await fetch(`${API}/oauth2/token/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
      });
    },

    async user(accessToken: string): Promise<DiscordUser> {
      const u = await call<{ id: string; username: string; global_name?: string | null; avatar?: string | null }>(
        "/users/@me",
        `Bearer ${accessToken}`,
      );
      return {
        id: u.id,
        name: u.global_name || u.username,
        username: u.username,
        avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
      };
    },

    /** The user's servers (scope `guilds`). */
    userGuilds(userId: string, accessToken: string): Promise<PartialGuild[]> {
      // shortcut: one page of 200, the most a Discord account can join.
      return userGuilds(userId, () => call<PartialGuild[]>("/users/@me/guilds?limit=200", `Bearer ${accessToken}`));
    },

    /** Ids of the servers the bot is in; empty without the bot token. */
    botGuildIds(): Promise<Set<string>> {
      if (!botToken) return Promise.resolve(new Set());
      return botGuilds("", async () => {
        const ids = new Set<string>();
        for (let after = "0"; ; ) {
          const page = await bot<{ id: string }[]>(`/users/@me/guilds?limit=200&after=${after}`);
          for (const g of page) ids.add(g.id);
          if (page.length < 200) return ids;
          after = page.at(-1)!.id;
        }
      });
    },

    guild: (guildId: string) => guilds(guildId, () => bot<Guild>(`/guilds/${guildId}`)),
    channels: (guildId: string) => channels(guildId, () => bot<Channel[]>(`/guilds/${guildId}/channels`)),

    /** Null when they're not in the server. */
    member(guildId: string, userId: string): Promise<Member | null> {
      return members(`${guildId}/${userId}`, () =>
        bot<Member>(`/guilds/${guildId}/members/${userId}`).catch((err) => {
          if (err instanceof DiscordError && err.status === 404) return null;
          throw err;
        }),
      );
    },

    /** The voice channel they're connected to in that server, or null (also when Discord won't say). */
    async voiceChannel(guildId: string, userId: string): Promise<string | null> {
      if (!botToken) return null;
      const state = await bot<{ channel_id?: string | null }>(`/guilds/${guildId}/voice-states/${userId}`).catch(() => null);
      return state?.channel_id ?? null;
    },

    /** Server mute / deafen, or `channel_id: null` to disconnect from voice. Shown in the audit log with `reason`. */
    async editMember(guildId: string, userId: string, change: { mute?: boolean; deaf?: boolean; channel_id?: null }, reason: string) {
      try {
        await bot(`/guilds/${guildId}/members/${userId}`, { method: "PATCH", body: change, reason });
      } finally {
        // A rejoin reads their new server mute / deafen.
        members.drop(`${guildId}/${userId}`);
      }
    },

    /** A discord.gg link that opens the HypeMeet Activity in that voice channel. */
    async activityInvite(channelId: string): Promise<string> {
      const invite = await bot<{ code: string }>(`/channels/${channelId}/invites`, {
        method: "POST",
        body: { max_age: 86400, target_type: 2, target_application_id: clientId },
      });
      return `https://discord.gg/${invite.code}`;
    },

    botInviteUrl(guildId: string): string {
      const params = new URLSearchParams({
        client_id: clientId,
        scope: "bot",
        permissions: String(BOT_PERMISSIONS),
        guild_id: guildId,
        disable_guild_select: "true",
      });
      return `https://discord.com/oauth2/authorize?${params}`;
    },
  };
}

export type Discord = ReturnType<typeof createDiscord>;
