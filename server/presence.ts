import { ParticipantInfo_State, type RoomServiceClient } from "livekit-server-sdk";

// Who's in a room right now, for link previews. Crawlers hit the page and its og:image back to back
// (and Discord/WhatsApp often fetch twice), so answers are cached for a few seconds.
const TTL_MS = 5_000;
// Previews must not hang on LiveKit: crawlers give up after a few seconds.
const TIMEOUT_MS = 2_000;

export function createPreviewPresence(livekit: RoomServiceClient) {
  const cache = new Map<string, { at: number; people: Promise<string[]> }>();

  async function fetchPeople(code: string): Promise<string[]> {
    try {
      const participants = await Promise.race([
        livekit.listParticipants(code),
        Bun.sleep(TIMEOUT_MS).then(() => Promise.reject(new Error("timeout"))),
      ]);
      const names = participants
        .filter((p) => p.state !== ParticipantInfo_State.DISCONNECTED)
        .sort((a, b) => Number(a.joinedAt - b.joinedAt))
        .map((p) => p.name || p.identity.split("#")[0]!);
      // One person with two tabs is two participants with the same name.
      return [...new Set(names)];
    } catch {
      // Nobody has joined yet (LiveKit only knows rooms while they're alive) or LiveKit is down:
      // either way, an empty room is the honest preview.
      return [];
    }
  }

  return {
    people(code: string): Promise<string[]> {
      const now = Date.now();
      for (const [key, entry] of cache) if (now - entry.at > TTL_MS) cache.delete(key);
      let entry = cache.get(code);
      if (!entry) cache.set(code, (entry = { at: now, people: fetchPeople(code) }));
      return entry.people;
    },
  };
}
