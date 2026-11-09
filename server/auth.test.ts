import { expect, test } from "bun:test";
import { SQL, type BunRequest } from "bun";
import { createAuth, safeNext } from "./auth";
import { migrate } from "./db";
import { DiscordError, type Discord } from "./discord";
import { testDatabase } from "./testdb";

test("login comes back only to a path on this site", () => {
  expect(safeNext("/r/ABC?x=1#y")).toBe("/r/ABC?x=1#y");
  expect(safeNext("/")).toBe("/");
  for (const evil of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/.//evil.com", "/%2e//evil.com", "/a/..//evil.com", "https://evil.com", "evil", "", null, 1])
    expect(safeNext(evil)).toBe("/");
});

async function sessionRoundTrip(sql: SQL) {
  let refreshes = 0;
  let refuse = false;
  let offline = false;
  const discord = {
    enabled: true,
    authorizeUrl: (_uri: string, state: string) => `https://discord.com/oauth2/authorize?state=${state}`,
    // Expires within the refresh margin, so the first use refreshes it.
    exchangeCode: async () => ({ accessToken: "a1", refreshToken: "r1", expiresIn: 30 }),
    user: async () => ({ id: "400000", name: "Ana", username: "ana", avatarUrl: null }),
    refresh: async (token: string) => {
      refreshes++;
      await Bun.sleep(5);
      if (offline) throw new TypeError("fetch failed");
      // What discord.ts's oauthToken throws for invalid_grant.
      if (refuse || token !== "r1") throw new DiscordError("discord refresh_token failed (400)", 400);
      return { accessToken: "a2", refreshToken: "r2", expiresIn: 604800 };
    },
    revoke: async () => {},
  } as unknown as Discord;
  const auth = createAuth({ sql, discord, origin: () => "https://hypemeet.example" });
  const request = (url: string, cookies = "") =>
    Object.assign(new Request(`https://hypemeet.example${url}`), { cookies: new Bun.CookieMap(cookies) }) as unknown as BunRequest;

  const start = request("/api/auth/discord?next=/r/ABC");
  auth.login(start);
  const oauth = start.cookies.get("hm_oauth")!;
  const state = JSON.parse(oauth).state as string;
  // Forged state: no session.
  const forged = request(`/api/auth/discord/callback?code=c&state=nope`, `hm_oauth=${encodeURIComponent(oauth)}`);
  await auth.callback(forged);
  expect(forged.cookies.get("hm_session")).toBeNull();

  const signIn = async () => {
    const back = request(`/api/auth/discord/callback?code=c&state=${state}`, `hm_oauth=${encodeURIComponent(oauth)}`);
    expect((await auth.callback(back)).headers.get("location")).toBe("/r/ABC");
    return `hm_session=${back.cookies.get("hm_session")}`;
  };
  const session = await signIn();

  const [a, b] = await Promise.all([auth.signedIn(request("/", session)), auth.signedIn(request("/", session))]);
  expect(refreshes).toBe(1);
  expect([a?.accessToken, b?.accessToken]).toEqual(["a2", "a2"]);
  expect(a?.user.name).toBe("Ana");
  expect(await (await auth.me(request("/", session))).json()).toMatchObject({ user: { id: "400000" }, login: true });
  expect(await auth.signedIn(request("/", "hm_session=someone-else"))).toBeNull();

  await auth.logout(request("/", session));
  expect(await auth.signedIn(request("/", session))).toBeNull();

  const other = await signIn();
  // Discord not answering keeps the session, with the old token, and the next request tries again.
  offline = true;
  expect(await (await auth.me(request("/", other))).json()).toMatchObject({ user: { id: "400000" }, login: true });
  expect((await auth.signedIn(request("/", other)))?.accessToken).toBe("a1");
  offline = false;
  expect((await auth.signedIn(request("/", other)))?.accessToken).toBe("a2");
  // Discord turning their token down on a call (server/index.ts) ends the session and its cookie.
  const ending = request("/", other);
  await auth.end(ending);
  expect(ending.cookies.get("hm_session")).toBeNull();
  expect(await auth.signedIn(request("/", other))).toBeNull();

  const third = await signIn();
  refuse = true;
  // /api/me asks Discord too: a session it let go reads as signed out right away.
  expect(await (await auth.me(request("/", third))).json()).toMatchObject({ user: null, login: true });
  expect(await auth.signedIn(request("/", third))).toBeNull();
}

const DESCRIPTION = "session: login round trip, one refresh for concurrent requests, kept while Discord is down, gone when it refuses";

test(`${DESCRIPTION} (sqlite in memory)`, async () => {
  const sql = new SQL(":memory:");
  await migrate(sql);
  await sessionRoundTrip(sql);
  await sql.close();
});

test.skipIf(!process.env.DATABASE_URL)(`${DESCRIPTION} (postgres)`, async () => {
  const db = await testDatabase();
  try {
    await sessionRoundTrip(db.sql);
  } finally {
    await db.drop();
  }
});

test("a refresh that lost the race to another request's keeps the session (sqlite in memory)", async () => {
  const real = new SQL(":memory:");
  await migrate(real);
  // Holds back the answer of one session lookup, as a slow pool connection would: it read the row before the refresh.
  let hold: Promise<void> | null = null;
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = real(strings, ...values);
    const wait = strings[0]!.startsWith("SELECT id") ? hold : null;
    if (!wait) return query;
    hold = null;
    return query.then(async (rows: unknown) => (await wait, rows));
  }) as unknown as SQL;
  const used = new Set<string>();
  const discord = {
    // Discord rotates refresh tokens: each one works once.
    refresh: async (token: string) => {
      if (used.has(token)) throw new DiscordError("discord refresh_token failed (400)", 400);
      used.add(token);
      await Bun.sleep(5);
      return { accessToken: "a2", refreshToken: "r2", expiresIn: 604800 };
    },
  } as unknown as Discord;
  const auth = createAuth({ sql, discord, origin: () => "https://hypemeet.example" });
  const id = new Bun.CryptoHasher("sha256").update("cookie").digest("hex");
  await real`INSERT INTO sessions (id, user_json, access_token, refresh_token, token_expires_at, expires_at)
    VALUES (${id}, ${'{"id":"400000"}'}, ${"a1"}, ${"r1"}, ${Date.now()}, ${Date.now() + 60_000})`;
  const request = () => Object.assign(new Request("https://hypemeet.example/"), { cookies: new Bun.CookieMap("hm_session=cookie") }) as unknown as BunRequest;

  let release!: () => void;
  hold = new Promise((resolve) => (release = resolve));
  const late = auth.signedIn(request());
  expect((await auth.signedIn(request()))?.accessToken).toBe("a2");
  release();
  // It refreshes r1 again and is refused, but the row moved on: the new token, and the session stays.
  expect((await late)?.accessToken).toBe("a2");
  expect((await auth.signedIn(request()))?.accessToken).toBe("a2");
  await real.close();
});

test("a 401 on the user's token ends the session, unless the token had just expired (sqlite in memory)", async () => {
  const sql = new SQL(":memory:");
  await migrate(sql);
  const auth = createAuth({ sql, discord: {} as Discord, origin: () => "https://hypemeet.example" });
  const request = (cookie: string) =>
    Object.assign(new Request("https://hypemeet.example/"), { cookies: new Bun.CookieMap(`hm_session=${cookie}`) }) as unknown as BunRequest;
  const add = (cookie: string, tokenExpiresAt: number) =>
    sql`INSERT INTO sessions (id, user_json, access_token, refresh_token, token_expires_at, expires_at)
      VALUES (${new Bun.CryptoHasher("sha256").update(cookie).digest("hex")}, ${'{"id":"400000"}'}, ${"a1"}, ${"r1"}, ${tokenExpiresAt}, ${Date.now() + 60_000})`;
  await add("expired", Date.now() - 1000);
  await add("live", Date.now() + 3_600_000);
  expect(await auth.revoked(request("expired"))).toBe(false);
  expect((await auth.signedIn(request("live")))?.accessToken).toBe("a1");
  expect(await auth.revoked(request("live"))).toBe(true);
  expect(await auth.signedIn(request("live"))).toBeNull();
  await sql.close();
});
