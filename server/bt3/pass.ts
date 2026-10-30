/**
 * The Budokai Tenkaichi 3 plugin's access pass: proof that whoever loads its page is in some room. It rides in the
 * path (/plugins/bt3/p/<pass>/...) because the plugin's iframe sends no headers and, in Discord, has no cookie.
 *
 *   base64url(JSON { id, name, exp }) "." base64url(HMAC-SHA256(secret, first part))
 */

export interface Pass {
  /** The room identity it was issued to (one connection). */
  id: string;
  /** Their nickname, for "Fulano está enviando a ISO". */
  name: string;
  /** Expiry, ms since the epoch. */
  exp: number;
}

export const PASS_TTL_MS = 12 * 60 * 60_000;

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function createPasses(secret: string, now = () => Date.now()) {
  const key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const sign = async (body: string) => new Uint8Array(await crypto.subtle.sign("HMAC", await key, encoder.encode(body)));

  return {
    async issue(id: string, name: string): Promise<string> {
      const body = b64url(encoder.encode(JSON.stringify({ id, name, exp: now() + PASS_TTL_MS } satisfies Pass)));
      return `${body}.${b64url(await sign(body))}`;
    },
    /** The pass's holder, or null when it's forged, damaged or expired. */
    async verify(pass: string): Promise<Pass | null> {
      const [body, mac, extra] = pass.split(".");
      if (!body || !mac || extra !== undefined) return null;
      const ok = await crypto.subtle.verify("HMAC", await key, Buffer.from(mac, "base64url"), encoder.encode(body));
      if (!ok) return null;
      try {
        const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<Pass>;
        if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.exp !== "number" || p.exp <= now()) return null;
        return { id: p.id, name: p.name, exp: p.exp };
      } catch {
        return null;
      }
    },
  };
}

export type Passes = ReturnType<typeof createPasses>;

/** What a room token says about its holder (livekit-server-sdk's ClaimGrants, the part read here). */
export interface RoomClaims {
  sub?: string;
  name?: string;
  video?: { room?: string };
  attributes?: Record<string, string>;
}

/**
 * A pass for whoever holds this room token: a valid token of a room that exists, from someone in it (not a
 * browser transmitter, which only sends screens for someone else). Null otherwise.
 */
export async function passForToken(
  token: unknown,
  deps: { verify: (token: string) => Promise<RoomClaims>; roomExists: (code: string) => boolean; passes: Passes },
): Promise<string | null> {
  const claims = typeof token === "string" && token ? await deps.verify(token).catch(() => null) : null;
  if (!claims?.sub || !claims.video?.room || !deps.roomExists(claims.video.room) || claims.attributes?.castFor) return null;
  return deps.passes.issue(claims.sub, claims.name || claims.sub.split("#")[0]!);
}
