import type { SQL } from "bun";

export interface Room {
  code: string;
  name: string;
  createdAt: number;
  /** A server voice channel's room: only for who can join that channel in Discord. Null when the server isn't known. */
  discord: { guildId: string; channelId: string } | null;
}

type Row = { code: string; name: string; createdAt: string | number; guildId: string | null; channelId: string | null };

// BIGINT comes back from Postgres as a string.
const toRoom = ({ guildId, channelId, createdAt, ...room }: Row): Room => ({
  ...room,
  createdAt: Number(createdAt),
  discord: guildId && channelId ? { guildId, channelId } : null,
});

/** Its stored server isn't the one asked for: someone is passing another server's channel off as theirs. */
export class ChannelMismatch extends Error {}

// No 0/O/1/I/L to keep codes easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
export const NAME_MAX = 60;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = "";
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

export interface GuildPrefs {
  order: string[];
  favorites: string[];
}

const SNOWFLAKE = /^\d{5,25}$/;
/** A posted GuildPrefs, or null when it isn't one. Capped: nobody is in more than 200 servers. */
export function parseGuildPrefs(body: unknown): GuildPrefs | null {
  const ids = (v: unknown) =>
    Array.isArray(v) && v.length <= 200 && v.every((id) => typeof id === "string" && SNOWFLAKE.test(id)) ? [...new Set(v as string[])] : null;
  const b = body as Partial<Record<keyof GuildPrefs, unknown>> | null;
  const order = ids(b?.order);
  const favorites = ids(b?.favorites);
  return order && favorites ? { order, favorites } : null;
}

/** Favourites first, then the saved order, then the rest (the bot's first), each group keeping what came before. */
export function orderGuilds<T extends { id: string; bot: boolean }>(list: T[], prefs: GuildPrefs): (T & { favorite: boolean })[] {
  const favorites = new Set(prefs.favorites);
  const position = new Map(prefs.order.map((id, i) => [id, i]));
  const rank = (g: T) => position.get(g.id) ?? Infinity;
  return list
    .map((g, i) => ({ g, i }))
    .sort((a, b) =>
      Number(favorites.has(b.g.id)) - Number(favorites.has(a.g.id)) ||
      rank(a.g) - rank(b.g) ||
      Number(b.g.bot) - Number(a.g.bot) ||
      a.i - b.i,
    )
    .map(({ g }) => ({ ...g, favorite: favorites.has(g.id) }));
}

/** Rooms in Postgres (schema: server/db.ts). */
export function openRoomStore(sql: SQL) {
  async function create(db: SQL, name: string): Promise<Room> {
    // Collisions are astronomically rare (31^6 ≈ 887M), but ON CONFLICT DO NOTHING + retry keeps it correct.
    for (let attempt = 0; attempt < 8; attempt++) {
      const [room] = await db<Row[]>`INSERT INTO rooms (code, name, created_at) VALUES (${randomCode()}, ${name}, ${Date.now()})
        ON CONFLICT DO NOTHING RETURNING code, name, created_at AS "createdAt"`;
      if (room) return toRoom({ ...room, guildId: null, channelId: null });
    }
    throw new Error("could not allocate a room code");
  }
  // FOR UPDATE: concurrent joins of one channel take turns, so its guild id is checked against the latest one.
  const channelRow = async (db: SQL, channelId: string) =>
    (
      await db<Row[]>`SELECT r.code, r.name, r.created_at AS "createdAt", d.guild_id AS "guildId", d.channel_id AS "channelId"
        FROM discord_channels d JOIN rooms r ON r.code = d.code WHERE d.channel_id = ${channelId} FOR UPDATE OF d`
    )[0];

  const claim = (db: SQL, channelId: string, guildId: string) =>
    db`INSERT INTO discord_claims (channel_id, guild_id) VALUES (${channelId}, ${guildId}) ON CONFLICT DO NOTHING`;

  return {
    create: (name: string) => create(sql, name),
    async get(code: string): Promise<Room | null> {
      // Accept "abc-def", "ABC DEF", etc.
      const [row] = await sql<Row[]>`SELECT r.code, r.name, r.created_at AS "createdAt", d.guild_id AS "guildId", d.channel_id AS "channelId"
        FROM rooms r LEFT JOIN discord_channels d ON d.code = r.code WHERE r.code = ${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
      return row ? toRoom(row) : null;
    },
    /**
     * The channel's room, created on first use. A renamed channel renames its room (null name: keep it).
     * The server is stored only when `verified` (the bot vouched the channel is in it). A stored server is never
     * replaced by another one (nor by none): that throws ChannelMismatch.
     */
    forDiscordChannel(channelId: string, name: string | null, guildId: string | null, verified: boolean): Promise<Room> {
      const stored = verified ? guildId : null;
      return sql.begin(async (tx) => {
        let row = await channelRow(tx, channelId);
        if (!row) {
          const created = await create(tx, name ?? "Discord");
          const [won] = await tx`INSERT INTO discord_channels (channel_id, code, guild_id) VALUES (${channelId}, ${created.code}, ${stored})
            ON CONFLICT DO NOTHING RETURNING code`;
          if (won) {
            if (!stored && guildId) await claim(tx, channelId, guildId);
            return { ...created, discord: stored ? { guildId: stored, channelId } : null };
          }
          // Another first join got there first: its room is the channel's (a channel moved to a fresh room lands here too).
          await tx`DELETE FROM rooms WHERE code = ${created.code}`;
          row = (await channelRow(tx, channelId))!;
        }
        if (row.guildId && row.guildId !== guildId) throw new ChannelMismatch(`channel ${channelId} is in guild ${row.guildId}`);
        if (!row.guildId && stored) {
          // Its room was open to anyone with the code, who may still hold tokens: the gated channel gets a fresh one.
          const fresh = await create(tx, name ?? row.name);
          await tx`UPDATE discord_channels SET guild_id = ${stored}, code = ${fresh.code} WHERE channel_id = ${channelId}`;
          return { ...fresh, discord: { guildId: stored, channelId } };
        }
        if (name && row.name !== name) await tx`UPDATE rooms SET name = ${name} WHERE code = ${row.code}`;
        if (!row.guildId && guildId) await claim(tx, channelId, guildId);
        return toRoom({ ...row, name: name || row.name });
      });
    },
    /** Channel id → its room's code, for the channels of this server that have one. */
    async codesFor(guildId: string, channelIds: string[]): Promise<Map<string, string>> {
      if (!channelIds.length) return new Map();
      const rows = await sql<{ channelId: string; code: string }[]>`SELECT channel_id AS "channelId", code FROM discord_channels
        WHERE guild_id = ${guildId} AND channel_id IN ${sql(channelIds)}`;
      return new Map(rows.map((r) => [r.channelId, r.code]));
    },
    /** Muted by a moderator in this room (or not anymore): kept, so a reload doesn't bring their microphone back. */
    async setMuted(code: string, discordId: string, muted: boolean) {
      if (muted) await sql`INSERT INTO room_mutes (code, discord_id) VALUES (${code}, ${discordId}) ON CONFLICT DO NOTHING`;
      else await sql`DELETE FROM room_mutes WHERE code = ${code} AND discord_id = ${discordId}`;
    },
    /** Servers with at least one channel room: bot-verified, or claimed by the Activity (claimedRooms). */
    async guildsWithRooms(): Promise<Set<string>> {
      const rows = await sql<{ guildId: string }[]>`SELECT guild_id AS "guildId" FROM discord_channels WHERE guild_id IS NOT NULL
        UNION SELECT c.guild_id FROM discord_claims c JOIN discord_channels d ON d.channel_id = c.channel_id WHERE d.guild_id IS NULL`;
      return new Set(rows.map((r) => r.guildId));
    },
    /** The ungated channel rooms the Activity opened in this server (without the bot), oldest first. */
    async claimedRooms(guildId: string): Promise<{ channelId: string; code: string; name: string }[]> {
      return sql`SELECT c.channel_id AS "channelId", r.code, r.name FROM discord_claims c
        JOIN discord_channels d ON d.channel_id = c.channel_id AND d.guild_id IS NULL JOIN rooms r ON r.code = d.code
        WHERE c.guild_id = ${guildId} ORDER BY r.created_at, r.code`;
    },
    async guildPrefs(userId: string): Promise<GuildPrefs> {
      const [row] = await sql<{ order: string; favorites: string }[]>`SELECT guild_order AS "order", favorites FROM guild_prefs WHERE user_id = ${userId}`;
      return row ? { order: JSON.parse(row.order), favorites: JSON.parse(row.favorites) } : { order: [], favorites: [] };
    },
    async setGuildPrefs(userId: string, prefs: GuildPrefs) {
      const order = JSON.stringify(prefs.order);
      const favorites = JSON.stringify(prefs.favorites);
      await sql`INSERT INTO guild_prefs (user_id, guild_order, favorites) VALUES (${userId}, ${order}, ${favorites})
        ON CONFLICT (user_id) DO UPDATE SET guild_order = ${order}, favorites = ${favorites}`;
    },
    async isMuted(code: string, discordId: string): Promise<boolean> {
      return (await sql`SELECT 1 FROM room_mutes WHERE code = ${code} AND discord_id = ${discordId}`).length > 0;
    },
  };
}
