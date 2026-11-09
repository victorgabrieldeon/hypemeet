// Postgres through Bun's built-in client: the connection, the schema, and the one-time copy of the old SQLite database.

import { SQL } from "bun";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const IMPORTED = "sqlite_imported";
// Postgres takes at most 65535 parameters per statement; sessions have 6 columns.
const CHUNK = 1000;

/** Connected and migrated. Unreachable → a clear crash (Dokploy restarts it): without its database the server is no use. */
export async function openDatabase(url: string): Promise<SQL> {
  const sql = new SQL(url);
  try {
    await sql.connect();
  } catch (err) {
    const { hostname, port, pathname } = new URL(url);
    throw new Error(`can't reach Postgres at ${hostname}:${port || 5432}${pathname} (DATABASE_URL): ${(err as Error).message}`);
  }
  await migrate(sql);
  return sql;
}

/** The schema, created when missing. Plain SQL that SQLite runs too (the pure tests use it in memory). */
export async function migrate(sql: SQL) {
  await sql`
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    -- Discord voice channel → its room, so everyone who opens it lands together. No guild id: a DM's, or not known yet.
    CREATE TABLE IF NOT EXISTS discord_channels (
      channel_id TEXT PRIMARY KEY,
      code TEXT NOT NULL REFERENCES rooms (code),
      guild_id TEXT
    );
    -- Every room lookup joins on it.
    CREATE INDEX IF NOT EXISTS discord_channels_code ON discord_channels (code);
    -- Site sign-ins (server/auth.ts); id is the SHA-256 of the cookie.
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_json TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
    -- Who a moderator muted in a channel's room (Discord id), until unmuted (server/index.ts /api/moderate).
    CREATE TABLE IF NOT EXISTS room_mutes (
      code TEXT NOT NULL REFERENCES rooms (code),
      discord_id TEXT NOT NULL,
      PRIMARY KEY (code, discord_id)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `.simple();
}

/** Everything in the SQLite database of before Postgres, read-only. Channels whose room is missing are left out. */
export function readSqlite(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    const tables = new Set(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
    const all = <T>(table: string, query: string) => (tables.has(table) ? db.query<T, []>(query).all() : []);
    return {
      // Postgres refuses NUL in text, which SQLite took: one such name would fail the whole import on every start.
      rooms: all<{ code: string; name: string; created_at: number }>("rooms", "SELECT code, name, created_at FROM rooms").map((r) => ({
        ...r,
        name: r.name.replaceAll("\0", ""),
      })),
      // d.*: older files have no guild_id column.
      channels: all<{ channel_id: string; code: string; guild_id?: string | null }>(
        "discord_channels",
        "SELECT d.* FROM discord_channels d JOIN rooms r ON r.code = d.code",
      ).map((c) => ({ channel_id: c.channel_id, code: c.code, guild_id: c.guild_id ?? null })),
      sessions: all<{ id: string; user_json: string; access_token: string; refresh_token: string; token_expires_at: number; expires_at: number }>(
        "sessions",
        "SELECT id, user AS user_json, access_token, refresh_token, token_expires_at, expires_at FROM sessions",
      ),
    };
  } finally {
    db.close();
  }
}

/** Copies the SQLite database at `path` into Postgres once (rows already there are kept). The file is never touched. */
export async function importSqlite(sql: SQL, path: string) {
  if (!existsSync(path) || (await sql`SELECT 1 FROM meta WHERE key = ${IMPORTED}`).length) return;
  const old = readSqlite(path);
  const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));
  const imported = await sql.begin(async (tx) => {
    const count = { rooms: 0, channels: 0, sessions: 0 };
    // Rooms first: channels reference them.
    for (const rows of chunks(old.rooms)) count.rooms += (await tx`INSERT INTO rooms ${tx(rows)} ON CONFLICT DO NOTHING`).count;
    for (const rows of chunks(old.channels)) count.channels += (await tx`INSERT INTO discord_channels ${tx(rows)} ON CONFLICT DO NOTHING`).count;
    for (const rows of chunks(old.sessions)) count.sessions += (await tx`INSERT INTO sessions ${tx(rows)} ON CONFLICT DO NOTHING`).count;
    await tx`INSERT INTO meta (key, value) VALUES (${IMPORTED}, ${new Date().toISOString()}) ON CONFLICT DO NOTHING`;
    return count;
  });
  console.log(
    `imported ${path} into Postgres: ${imported.rooms}/${old.rooms.length} rooms, ${imported.channels}/${old.channels.length} channels, ${imported.sessions}/${old.sessions.length} sessions (the rest were already there)`,
  );
}
