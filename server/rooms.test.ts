import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importSqlite, readSqlite } from "./db";
import { ChannelMismatch, openRoomStore, orderGuilds, parseGuildPrefs } from "./rooms";
import { testDatabase } from "./testdb";

const PG = !!process.env.DATABASE_URL;

/** A SQLite database from before guild ids, with a channel whose room is gone, a NUL in a name and a session. */
function oldSqlite() {
  const path = join(mkdtempSync(join(tmpdir(), "hm-rooms-")), "test.db");
  const old = new Database(path, { create: true });
  old.run("CREATE TABLE rooms (code TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)");
  old.run("CREATE TABLE discord_channels (channel_id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES rooms (code))");
  old.run("INSERT INTO rooms VALUES ('AAAAAA', 'Geral', 1), ('BBBBBB', 'Gru' || char(0) || 'po', 1730000000000)");
  old.run("INSERT INTO discord_channels VALUES ('111111', 'AAAAAA'), ('999999', 'GONE00')");
  old.run(`CREATE TABLE sessions (id TEXT PRIMARY KEY, user TEXT NOT NULL, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
  old.run(`INSERT INTO sessions VALUES ('hash', '{"id":"400000"}', 'a1', 'r1', 1730000000000, 1740000000000)`);
  old.close();
  return path;
}

test("sqlite import source: read-only, old schemas, orphans left out", () => {
  const path = oldSqlite();
  const before = readFileSync(path);
  expect(readSqlite(path)).toEqual({
    rooms: [
      { code: "AAAAAA", name: "Geral", created_at: 1 },
      { code: "BBBBBB", name: "Grupo", created_at: 1730000000000 },
    ],
    channels: [{ channel_id: "111111", code: "AAAAAA", guild_id: null }],
    sessions: [{ id: "hash", user_json: '{"id":"400000"}', access_token: "a1", refresh_token: "r1", token_expires_at: 1730000000000, expires_at: 1740000000000 }],
  });
  expect(readFileSync(path).equals(before)).toBe(true);
});

let db: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  if (PG) db = await testDatabase();
});
afterAll(() => db?.drop());

test.skipIf(!PG)("postgres: the sqlite file is imported once, keeping what's there", async () => {
  const path = oldSqlite();
  await importSqlite(db.sql, path);
  const rooms = openRoomStore(db.sql);
  expect(await rooms.get("aaa-aaa")).toEqual({ code: "AAAAAA", name: "Geral", createdAt: 1, discord: null });
  expect(await rooms.get("BBBBBB")).toMatchObject({ name: "Grupo", createdAt: 1730000000000 });
  expect([...(await db.sql`SELECT id, user_json, expires_at::text FROM sessions`)]).toEqual([{ id: "hash", user_json: '{"id":"400000"}', expires_at: "1740000000000" }]);
  // Already imported: a room added to the file later isn't.
  const later = new Database(path);
  later.run("INSERT INTO rooms VALUES ('CCCCCC', 'Depois', 2)");
  later.close();
  await importSqlite(db.sql, path);
  expect(await rooms.get("CCCCCC")).toBeNull();
});

test.skipIf(!PG)("postgres: a channel's server is stored only when verified, then never changes; an open room isn't gated in place", async () => {
  const rooms = openRoomStore(db.sql);
  // The imported channel has no server: an unverified claim keeps its open room.
  expect(await rooms.forDiscordChannel("111111", null, "900000", false)).toMatchObject({ code: "AAAAAA", discord: null });
  // A verified one moves the channel to a fresh room; the old one stays, as an ordinary room.
  const gated = await rooms.forDiscordChannel("111111", "Geral 2", "900000", true);
  expect(gated).toMatchObject({ name: "Geral 2", discord: { guildId: "900000", channelId: "111111" } });
  expect(gated.code).not.toBe("AAAAAA");
  expect(await rooms.get("AAAAAA")).toMatchObject({ name: "Geral", discord: null });
  expect(await rooms.get(gated.code)).toEqual(gated);
  // Its own server, even unverified (the bot left), still gets it.
  expect(await rooms.forDiscordChannel("111111", null, "900000", false)).toEqual(gated);
  // Another server, or none (a DM Activity), can't claim it, verified or not.
  await expect(rooms.forDiscordChannel("111111", "x", "800000", true)).rejects.toThrow(ChannelMismatch);
  await expect(rooms.forDiscordChannel("111111", "x", "800000", false)).rejects.toThrow(ChannelMismatch);
  await expect(rooms.forDiscordChannel("111111", "x", null, false)).rejects.toThrow(ChannelMismatch);
  expect((await rooms.get(gated.code))?.name).toBe("Geral 2");

  // An unverified first use stores no server, so it can't lock the channel's real one out.
  const open = await rooms.forDiscordChannel("666666", "Sala", "800000", false);
  expect(open.discord).toBeNull();
  expect((await rooms.forDiscordChannel("666666", "Sala", "900000", true)).discord).toEqual({ guildId: "900000", channelId: "666666" });

  const dm = await rooms.forDiscordChannel("222222", "Discord", null, false);
  expect(dm.discord).toBeNull();
  expect((await rooms.forDiscordChannel("222222", "Discord", null, false)).code).toBe(dm.code);
  const created = await rooms.create("Grupo");
  expect(created).toMatchObject({ name: "Grupo", discord: null });
  expect(await rooms.get(created.code)).toEqual(created);
  expect((await rooms.codesFor("900000", ["111111", "222222", "333333"])).get("111111")).toBe(gated.code);
  expect([...(await rooms.codesFor("900000", ["222222", "333333"])).keys()]).toEqual([]);
  expect(await rooms.codesFor("900000", [])).toEqual(new Map());
});

test.skipIf(!PG)("postgres: room mutes stay until unmuted", async () => {
  const rooms = openRoomStore(db.sql);
  const { code } = await rooms.create("Call");
  expect(await rooms.isMuted(code, "400000")).toBe(false);
  await rooms.setMuted(code, "400000", true);
  await rooms.setMuted(code, "400000", true);
  expect(await rooms.isMuted(code, "400000")).toBe(true);
  expect(await rooms.isMuted(code, "500000")).toBe(false);
  await rooms.setMuted(code, "400000", false);
  expect(await rooms.isMuted(code, "400000")).toBe(false);
});

test.skipIf(!PG)("postgres: simultaneous first joins of a channel land in one room", async () => {
  const rooms = openRoomStore(db.sql);
  const before = (await db.sql`SELECT count(*)::int AS n FROM rooms`)[0].n;
  const [a, b] = await Promise.all([rooms.forDiscordChannel("444444", "Call", "900000", true), rooms.forDiscordChannel("444444", "Call", "900000", true)]);
  expect(a.code).toBe(b.code);
  expect(a.discord).toEqual({ guildId: "900000", channelId: "444444" });
  // The loser's room is gone with it.
  expect((await db.sql`SELECT count(*)::int AS n FROM rooms`)[0].n).toBe(before + 1);

  // Two servers claiming one new channel at once: one of them gets it, the other is refused.
  const claims = await Promise.allSettled([rooms.forDiscordChannel("555555", "x", "900000", true), rooms.forDiscordChannel("555555", "x", "800000", true)]);
  expect(claims.filter((c) => c.status === "fulfilled")).toHaveLength(1);
  expect(claims.find((c) => c.status === "rejected")?.reason).toBeInstanceOf(ChannelMismatch);

  // Two verified claims on an open room at once: both land in the one fresh room.
  const open = await rooms.forDiscordChannel("777777", "Call", "900000", false);
  const count = (await db.sql`SELECT count(*)::int AS n FROM rooms`)[0].n;
  const [c, d] = await Promise.all([rooms.forDiscordChannel("777777", "Call", "900000", true), rooms.forDiscordChannel("777777", "Call", "900000", true)]);
  expect(c.code).toBe(d.code);
  expect(c.code).not.toBe(open.code);
  expect(d.discord).toEqual({ guildId: "900000", channelId: "777777" });
  expect((await rooms.get(open.code))?.discord).toBeNull();
  expect((await db.sql`SELECT count(*)::int AS n FROM rooms`)[0].n).toBe(count + 1);
});

test("servers: favourites first, then the saved order, then the bot's, then Discord's", () => {
  const g = (id: string, bot = false) => ({ id, bot });
  const list = [g("10001"), g("10002", true), g("10003"), g("10004", true), g("10005")];
  const out = orderGuilds(list, { order: ["10005", "10001"], favorites: ["10003"] });
  expect(out.map((x) => x.id)).toEqual(["10003", "10005", "10001", "10002", "10004"]);
  expect(out.map((x) => x.favorite)).toEqual([true, false, false, false, false]);
});

test("server prefs: only lists of ids get through", () => {
  expect(parseGuildPrefs({ order: ["10001", "10001"], favorites: [] })).toEqual({ order: ["10001"], favorites: [] });
  for (const bad of [null, {}, { order: ["x"], favorites: [] }, { order: [], favorites: "10001" }, { order: Array(201).fill("10001"), favorites: [] }])
    expect(parseGuildPrefs(bad)).toBeNull();
});

test.skipIf(!PG)("server prefs and servers with rooms (postgres)", async () => {
  const db = await testDatabase();
  try {
    const store = openRoomStore(db.sql);
    expect(await store.guildPrefs("400000")).toEqual({ order: [], favorites: [] });
    await store.setGuildPrefs("400000", { order: ["10001"], favorites: ["10002"] });
    await store.setGuildPrefs("400000", { order: ["10002", "10001"], favorites: [] });
    expect(await store.guildPrefs("400000")).toEqual({ order: ["10002", "10001"], favorites: [] });
    await store.forDiscordChannel("555551", "Geral", "777771", true);
    await store.forDiscordChannel("555552", "Livre", null, false);
    expect([...(await store.guildsWithRooms())]).toEqual(["777771"]);
  } finally {
    await db.drop();
  }
});
