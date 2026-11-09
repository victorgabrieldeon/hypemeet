/**
 * Plugin passes: proof, for a plugin's own server, that whoever loads its page is in some room. A plugin asks for
 * them in its manifest ("pass": true); its page then opens with ?pass=<pass>, and its server asks who holds it at
 * POST /api/plugins/pass, here, the only place that can read it. It rides in the address because the iframe sends
 * no headers and, in Discord, has no cookie.
 *
 *   base64url(JSON { plugin, id, name, exp }) "." base64url(HMAC-SHA256(secret, first part))
 */

import { isTransmitter, nicknameOf } from "./identity";

export interface Pass {
  /** The plugin it was issued for: another one's pass is no good to it. */
  plugin: string;
  /** The room identity it was issued to (one connection). */
  id: string;
  /** Their nickname. */
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
    async issue(plugin: string, id: string, name: string): Promise<string> {
      const body = b64url(encoder.encode(JSON.stringify({ plugin, id, name, exp: now() + PASS_TTL_MS } satisfies Pass)));
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
        if (typeof p.plugin !== "string" || typeof p.id !== "string" || typeof p.name !== "string" || typeof p.exp !== "number" || p.exp <= now())
          return null;
        return { plugin: p.plugin, id: p.id, name: p.name, exp: p.exp };
      } catch {
        return null;
      }
    },
  };
}

export type Passes = ReturnType<typeof createPasses>;

/**
 * What a room token says about its holder (livekit-server-sdk's ClaimGrants, the part read here). A refreshed token
 * carries the name and attributes the client set, so who they are comes from `sub` (server/identity.ts).
 */
export interface RoomClaims {
  sub?: string;
  name?: string;
  video?: { room?: string };
}

/**
 * A pass to `plugin` for whoever holds this room token: a valid token of a room that exists, from someone in it (not
 * a browser transmitter, which only sends screens for someone else). Null otherwise.
 */
export async function passForToken(
  token: unknown,
  plugin: string,
  deps: { verify: (token: string) => Promise<RoomClaims>; roomExists: (code: string) => Promise<boolean>; passes: Passes },
): Promise<string | null> {
  const claims = typeof token === "string" && token ? await deps.verify(token).catch(() => null) : null;
  if (!claims?.sub || !claims.video?.room || !(await deps.roomExists(claims.video.room)) || isTransmitter(claims.sub)) return null;
  return deps.passes.issue(plugin, claims.sub, nicknameOf(claims.sub, claims.name));
}
