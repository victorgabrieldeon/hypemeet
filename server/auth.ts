// Signing in on the site with Discord (OAuth code grant) and the session cookie that remembers it.
// The cookie holds a random value; the database only its SHA-256, so a leaked database opens no sessions.

import type { BunRequest, SQL } from "bun";
import { DiscordError, type Discord, type DiscordUser, type Tokens } from "./discord";

const COOKIE = "hm_session";
const OAUTH_COOKIE = "hm_oauth";
const SESSION_MS = 30 * 24 * 60 * 60_000;
// Refresh the access token this close to its expiry.
const REFRESH_MARGIN_MS = 60_000;

export type Me = DiscordUser;

type Row = {
  id: string;
  user: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  expiresAt: number;
};

/** Discord said no to the refresh token (invalid_grant), as opposed to not answering. */
function refused(err: unknown): boolean {
  return err instanceof DiscordError && (err.status === 400 || err.status === 401);
}

const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const randomValue = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/** Where to land after login: a path on this site, never another one ("//evil", "/\\evil", "https://…") → "/". */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  // URL parsing drops tabs and newlines, which could turn "/\t/evil" into "//evil" in the browser.
  const url = new URL(next, "http://site");
  const path = url.pathname + url.search + url.hash;
  // Dot segments collapse after the check above: "/.//evil" comes out as "//evil".
  return url.host === "site" && !path.startsWith("//") ? path : "/";
}

export function createAuth(opts: { sql: SQL; discord: Discord; origin: (req: Request) => string }) {
  const { sql, discord } = opts;
  const purge = (now: number) => sql`DELETE FROM sessions WHERE expires_at <= ${now}`;
  const remove = (id: string) => sql`DELETE FROM sessions WHERE id = ${id}`;
  purge(Date.now()).catch((err) => console.error("session purge failed:", err));

  const redirectUri = (req: Request) => `${opts.origin(req)}/api/auth/discord/callback`;
  const secure = (req: Request) => opts.origin(req).startsWith("https:");
  async function find(req: BunRequest): Promise<Row | null> {
    const value = req.cookies.get(COOKIE);
    if (!value) return null;
    const [row] = await sql<Row[]>`SELECT id, user_json AS "user", access_token AS "accessToken", refresh_token AS "refreshToken",
      token_expires_at AS "tokenExpiresAt", expires_at AS "expiresAt" FROM sessions WHERE id = ${sha256(value)} AND expires_at > ${Date.now()}`;
    // BIGINT comes back from Postgres as a string.
    return row ? { ...row, tokenExpiresAt: Number(row.tokenExpiresAt), expiresAt: Number(row.expiresAt) } : null;
  }

  // Discord rotates refresh tokens: two requests refreshing at once would have the second one fail.
  const refreshing = new Map<string, Promise<string | null>>();
  function accessToken(row: Row): Promise<string | null> {
    if (row.tokenExpiresAt - Date.now() > REFRESH_MARGIN_MS) return Promise.resolve(row.accessToken);
    let pending = refreshing.get(row.id);
    if (!pending) {
      pending = discord
        .refresh(row.refreshToken)
        .then(
          async (t) => {
            await sql`UPDATE sessions SET access_token = ${t.accessToken}, refresh_token = ${t.refreshToken},
              token_expires_at = ${Date.now() + t.expiresIn * 1000} WHERE id = ${row.id}`;
            return t.accessToken;
          },
          async (err) => {
            console.error("discord token refresh failed:", err);
            // Only Discord refusing the refresh token ends the session. A hiccup (network, 5xx, 429) keeps it and the old
            // token: calls with it may fail for now, and the next request tries again.
            if (!refused(err)) return row.accessToken;
            // A request that read the row just before another one's refresh sent a token already rotated: the row
            // then holds the new ones, and the session stays.
            const gone = await sql`DELETE FROM sessions WHERE id = ${row.id} AND refresh_token = ${row.refreshToken} RETURNING id`;
            if (gone.length) return null;
            const [now] = await sql<{ accessToken: string }[]>`SELECT access_token AS "accessToken" FROM sessions WHERE id = ${row.id}`;
            return now?.accessToken ?? null;
          },
        )
        .finally(() => refreshing.delete(row.id));
      refreshing.set(row.id, pending);
    }
    return pending;
  }

  async function create(req: BunRequest, user: Me, tokens: Tokens) {
    const now = Date.now();
    await purge(now);
    const value = randomValue();
    await sql`INSERT INTO sessions (id, user_json, access_token, refresh_token, token_expires_at, expires_at)
      VALUES (${sha256(value)}, ${JSON.stringify(user)}, ${tokens.accessToken}, ${tokens.refreshToken}, ${now + tokens.expiresIn * 1000}, ${now + SESSION_MS})`;
    req.cookies.set(COOKIE, value, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MS / 1000, secure: secure(req) });
  }

  return {
    /**
     * Who's signed in, with an access token good for the next minute (the old one while Discord isn't answering);
     * null when nobody is (or Discord let go).
     */
    async signedIn(req: BunRequest): Promise<{ user: Me; accessToken: string } | null> {
      const row = await find(req);
      const token = row && (await accessToken(row));
      return row && token ? { user: JSON.parse(row.user) as Me, accessToken: token } : null;
    },

    /** GET /api/me → Session. Through signedIn, so a session Discord let go reads as signed out, not as a 401 later. */
    async me(req: BunRequest): Promise<Response> {
      const session = await this.signedIn(req);
      return Response.json({ user: session?.user ?? null, login: discord.enabled });
    },

    /** GET /api/auth/discord?next=/path → Discord's consent screen (skipped when already granted). */
    login(req: BunRequest): Response {
      if (!discord.enabled) return new Response("O login com o Discord não está configurado no servidor.", { status: 503 });
      const state = randomValue();
      const next = safeNext(new URL(req.url).searchParams.get("next"));
      req.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, next }), {
        httpOnly: true,
        sameSite: "lax",
        path: "/api/auth",
        maxAge: 600,
        secure: secure(req),
      });
      return Response.redirect(discord.authorizeUrl(redirectUri(req), state), 302);
    },

    /** GET /api/auth/discord/callback?code&state → session cookie, back to `next`. Cancelled or forged → just back. */
    async callback(req: BunRequest): Promise<Response> {
      const url = new URL(req.url);
      let saved: { state?: unknown; next?: unknown } | null = null;
      try {
        saved = JSON.parse(req.cookies.get(OAUTH_COOKIE) ?? "null");
      } catch {}
      req.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
      const next = safeNext(saved?.next);
      const code = url.searchParams.get("code");
      if (!discord.enabled || !code || typeof saved?.state !== "string" || url.searchParams.get("state") !== saved.state)
        return Response.redirect(next, 302);
      try {
        const tokens = await discord.exchangeCode(code, redirectUri(req));
        await create(req, await discord.user(tokens.accessToken), tokens);
      } catch (err) {
        console.error("discord login failed:", err);
      }
      return Response.redirect(next, 302);
    },

    /** Signs them out here: the session and its cookie. Also when Discord turned their token down (server/index.ts). */
    async end(req: BunRequest): Promise<Row | null> {
      const row = await find(req);
      if (row) await remove(row.id);
      req.cookies.delete({ name: COOKIE, path: "/" });
      return row;
    },

    /**
     * Discord answered 401 to their own token: they revoked it, so the session ends (true). Not when the token had
     * just expired while Discord couldn't refresh it (signedIn hands out the old one then): that session stays.
     */
    async revoked(req: BunRequest): Promise<boolean> {
      const row = await find(req);
      if (row && row.tokenExpiresAt <= Date.now()) return false;
      await this.end(req);
      return true;
    },

    /** POST /api/auth/logout */
    async logout(req: BunRequest): Promise<Response> {
      const row = await this.end(req);
      if (row) discord.revoke(row.accessToken).catch((err) => console.error("discord token revoke failed:", err));
      return Response.json({ ok: true });
    },
  };
}
