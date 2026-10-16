// HypeMeet as a Discord Activity: the page runs inside Discord's iframe, signs in with the Embedded App
// SDK and lands in the room tied to the voice channel it was launched from.
// Env: DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET (Developer Portal → OAuth2). Without them it's off.

const API = "https://discord.com/api/v10";

export interface DiscordUser {
  id: string;
  /** Display name (global name), falling back to the username. */
  name: string;
  /** cdn.discordapp.com/avatars/…, which the Activity's CSP allows without a URL mapping. Null → default avatar. */
  avatarUrl: string | null;
}

export function createDiscord() {
  const clientId = process.env.DISCORD_CLIENT_ID ?? "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? "";

  return {
    enabled: !!(clientId && clientSecret),

    /** Exchanges the code from `authorize` for an access token, which the client hands to `authenticate`. */
    async exchangeCode(code: string): Promise<string> {
      const res = await fetch(`${API}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
        }),
      });
      const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
      if (!res.ok || !body?.access_token) throw new Error(`discord token exchange failed (${res.status})`);
      return body.access_token;
    },

    async user(accessToken: string): Promise<DiscordUser> {
      const res = await fetch(`${API}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`discord user lookup failed (${res.status})`);
      const u = (await res.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };
      return {
        id: u.id,
        name: u.global_name || u.username,
        avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
      };
    },
  };
}
