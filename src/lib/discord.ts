// Running as a Discord Activity: Discord serves the page from https://<client id>.discordsays.com inside
// an iframe and proxies every request (URL mappings in the Developer Portal). `/` points at this site;
// `/livekit` must point at the LiveKit server for the room to connect.

/** The app's client id, read from the proxy host. Null outside Discord. */
export const discordClientId = /^(\d+)\.discordsays\.com$/.exec(location.hostname)?.[1] ?? null;

/** Discord opens the Activity with `frame_id` (and friends) in the query string. */
export const inDiscord = discordClientId !== null && new URLSearchParams(location.search).has("frame_id");

const allows = (feature: string) =>
  !!(document as { featurePolicy?: { allowsFeature(feature: string): boolean } }).featurePolicy?.allowsFeature(feature);

/**
 * Discord's iframe doesn't grant `display-capture` (and its mobile webviews have no getDisplayMedia at
 * all), so the picker fails at once with NotAllowedError. Checked up front so the UI can say so.
 */
export const screenCaptureBlocked =
  inDiscord && !(typeof navigator.mediaDevices?.getDisplayMedia === "function" && allows("display-capture"));

/** Nor `camera`: the camera goes through the browser transmitter too. */
export const cameraBlocked = inDiscord && !allows("camera");

/** Mapping prefix for the LiveKit server (Developer Portal → Activities → URL Mappings). */
const LIVEKIT_PREFIX = "/livekit";

/**
 * LiveKit's signaling has to go through Discord's proxy too: the real host is blocked by the iframe's
 * CSP. Null (dev) → this origin, where Vite already proxies `/rtc`.
 */
export function proxiedLiveKitUrl(url: string | null): string {
  const origin = `wss://${location.host}`;
  return url ? `${origin}${LIVEKIT_PREFIX}` : origin;
}
