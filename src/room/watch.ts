import { RoomEvent, RpcError, type Participant, type RemoteParticipant, type Room } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Watch party ("Assistir junto"): everyone plays the same YouTube video or local file on their own
 * player and keeps it in step. Only the playback state travels, never the video.
 *
 *   state   → the host's participant attribute "watch" (JSON), so late joiners read it on arrival
 *   changes → anyone's controls call the host over RPC; the host applies them and republishes
 *   clock   → positions are stamped with the host's clock; followers measure their offset to it by RPC
 *
 * The host is whoever started it. If they drop, the longest-present participant left adopts the last
 * known state, so the session outlives its host. Needs the canUpdateOwnMetadata grant.
 */

export const WATCH_TILE_ID = "watch";
const ATTRIBUTE = "watch";
const RPC_ACTION = "watch.action";
const RPC_CLOCK = "watch.clock";
const NAME_MAX = 200;

export type WatchSource =
  /** `title` and `live` are filled in by the host's player once it loads. */
  | { kind: "youtube"; videoId: string; title?: string; live?: boolean }
  /** Each viewer opens their own copy; name + size tell them which one. */
  | { kind: "file"; name: string; size: number };

export interface WatchState {
  /** Base36 start time + random, so comparing ids orders parties by when they started. */
  id: string;
  source: WatchSource;
  playing: boolean;
  /** Seconds into the video at `at`. For a live, seconds since the stream began (same for every viewer). */
  position: number;
  /** Playback speed (YouTube's own menu can change it). */
  rate: number;
  /** Host clock (ms) when `position` was taken. */
  at: number;
  /** Nickname of whoever made the last change. */
  by: string;
  /** Bumped on every change. */
  rev: number;
}

export type WatchAction =
  | { type: "load"; source: WatchSource; position?: number }
  /** Without a position, resumes where it was paused. */
  | { type: "play"; position?: number }
  | { type: "pause"; position: number }
  | { type: "seek"; position: number }
  | { type: "rate"; rate: number; position: number }
  /** What only a loaded player knows. A live also carries the host's live-edge position. */
  | { type: "meta"; title?: string; live?: boolean; position?: number }
  | { type: "stop" };

export interface WatchParty {
  state: WatchState;
  host: Participant;
}

export const sourceKey = (source: WatchSource) =>
  source.kind === "youtube" ? `youtube:${source.videoId}` : `file:${source.name}:${source.size}`;

/** Where the video should be at `hostNow` (host clock, ms). */
export function positionAt(state: WatchState, hostNow: number): number {
  return state.playing ? state.position + (Math.max(0, hostNow - state.at) / 1000) * state.rate : state.position;
}

const isSeconds = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const isRate = (n: unknown): n is number => typeof n === "number" && n >= 0.25 && n <= 2;

function parseSource(raw: unknown): WatchSource | null {
  const s = raw as Partial<Record<string, unknown>> | null;
  if (s?.kind === "youtube" && typeof s.videoId === "string" && /^[\w-]{11}$/.test(s.videoId))
    return {
      kind: "youtube",
      videoId: s.videoId,
      ...(typeof s.title === "string" ? { title: s.title.slice(0, NAME_MAX) } : {}),
      ...(s.live === true ? { live: true } : {}),
    };
  if (s?.kind === "file" && typeof s.name === "string" && isSeconds(s.size))
    return { kind: "file", name: s.name.slice(0, NAME_MAX), size: s.size };
  return null;
}

function parseState(raw: string | undefined): WatchState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<WatchState>;
    const source = parseSource(s.source);
    if (!source || typeof s.id !== "string" || !isSeconds(s.position) || !isSeconds(s.at) || !isSeconds(s.rev)) return null;
    return {
      id: s.id,
      source,
      playing: !!s.playing,
      position: s.position,
      rate: isRate(s.rate) ? s.rate : 1,
      at: s.at,
      by: String(s.by ?? ""),
      rev: s.rev,
    };
  } catch {
    return null;
  }
}

/** Peers are friends, but an action is still untrusted input to the host. */
function parseAction(raw: string): WatchAction | null {
  try {
    const a = JSON.parse(raw) as Record<string, unknown>;
    switch (a.type) {
      case "load": {
        const source = parseSource(a.source);
        return source ? { type: "load", source, ...(isSeconds(a.position) ? { position: a.position } : {}) } : null;
      }
      case "play":
        return { type: "play", ...(isSeconds(a.position) ? { position: a.position } : {}) };
      case "pause":
      case "seek":
        return isSeconds(a.position) ? { type: a.type, position: a.position } : null;
      case "rate":
        return isRate(a.rate) && isSeconds(a.position) ? { type: "rate", rate: a.rate, position: a.position } : null;
      case "meta":
        return {
          type: "meta",
          ...(typeof a.title === "string" ? { title: a.title.slice(0, NAME_MAX) } : {}),
          ...(a.live === true ? { live: true } : {}),
          ...(isSeconds(a.position) ? { position: a.position } : {}),
        };
      case "stop":
        return { type: "stop" };
    }
  } catch {
    // fall through
  }
  return null;
}

function reduce(state: WatchState | null, action: WatchAction, by: string, now: number): WatchState | null {
  if (action.type === "stop") return null;
  if (action.type === "load") {
    return {
      // Swapping the video keeps the party; a fresh one gets a fresh id.
      id: state?.id ?? `${now.toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
      source: action.source,
      // A file waits for everyone to open their copy; YouTube just starts.
      playing: action.source.kind === "youtube",
      position: action.position ?? 0,
      rate: 1,
      at: now,
      by,
      rev: (state?.rev ?? 0) + 1,
    };
  }
  if (!state) return null;
  const rev = state.rev + 1;
  switch (action.type) {
    case "play":
      return { ...state, playing: true, position: action.position ?? positionAt(state, now), at: now, by, rev };
    case "pause":
      return { ...state, playing: false, position: action.position, at: now, by, rev };
    case "seek":
      return { ...state, position: action.position, at: now, by, rev };
    case "rate":
      return { ...state, rate: action.rate, position: action.position, at: now, by, rev };
    case "meta": {
      // Not a user action, so `by` stays.
      const { source } = state;
      if (source.kind !== "youtube") return state;
      const title = source.title ?? action.title;
      const goesLive = !!action.live && !source.live;
      if (title === source.title && !goesLive) return state;
      const next = { ...state, source: { ...source, title, ...(source.live || goesLive ? { live: true } : {}) }, rev };
      // Until now positions came from the link (0); a live starts where the host's player joined it.
      return goesLive && action.position !== undefined ? { ...next, position: action.position, at: now } : next;
    }
  }
}

/** Earliest-started party wins if two people start at once; an adopted copy (same id) goes to the lower identity. */
export function readWatch(room: Room): WatchParty | null {
  let best: WatchParty | null = null;
  for (const host of [room.localParticipant, ...room.remoteParticipants.values()]) {
    const state = parseState(host.attributes[ATTRIBUTE]);
    if (!state) continue;
    if (!best || state.id < best.state.id || (state.id === best.state.id && host.identity < best.host.identity))
      best = { state, host };
  }
  return best;
}

/** Server-assigned join time, so every client ranks participants the same way. */
function byJoinOrder(a: Participant, b: Participant): number {
  const at = (p: Participant) => p.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return at(a) - at(b) || (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
}

export interface WatchControls {
  party: WatchParty | null;
  isHost: boolean;
  /** The host's clock, in ms: what `state.at` is measured against. */
  hostNow: () => number;
  /** Sends a change to the host (or applies it, if we are the host). Rejects if the host can't be reached. */
  dispatch: (action: WatchAction) => Promise<void>;
}

/** Shared watch-party state for the room. Re-renders ride on useRoomVersion (ParticipantAttributesChanged). */
export function useWatchParty(room: Room): WatchControls {
  const local = room.localParticipant;
  const party = readWatch(room);
  const isHost = party?.host === local;
  const hostIdentity = party && !isHost ? party.host.identity : null;
  const [clock, setClock] = useState<{ host: string; offset: number } | null>(null);
  const offset = hostIdentity && clock?.host === hostIdentity ? clock.offset : 0;

  // The host applies changes to its newest copy: its own attribute only updates once the server echoes it.
  const published = useRef<WatchState | null>(null);
  const latest = useRef({ party, isHost, offset });
  latest.current = { party, isHost, offset };

  const publish = useCallback(
    async (next: WatchState | null) => {
      published.current = next;
      await local.setAttributes({ [ATTRIBUTE]: next ? JSON.stringify(next) : "" });
    },
    [local],
  );

  const apply = useCallback(
    async (action: WatchAction, by: string) => {
      const { party, isHost } = latest.current;
      const own = isHost ? party!.state : null;
      const mine = published.current && (!own || published.current.rev >= own.rev) ? published.current : own;
      const next = reduce(mine, action, by, Date.now());
      if (next !== mine) await publish(next);
    },
    [publish],
  );

  const dispatch = useCallback(
    async (action: WatchAction) => {
      const { party, isHost } = latest.current;
      if (!party || isHost) return apply(action, local.name || local.identity);
      await local.performRpc({
        destinationIdentity: party.host.identity,
        method: RPC_ACTION,
        payload: JSON.stringify(action),
      });
    },
    [apply, local],
  );

  useEffect(() => {
    room.registerRpcMethod(RPC_CLOCK, async () => String(Date.now()));
    room.registerRpcMethod(RPC_ACTION, async ({ callerIdentity, payload }) => {
      if (!latest.current.isHost) throw new RpcError(1, "not the watch party host");
      const action = parseAction(payload);
      if (!action) throw new RpcError(2, "invalid watch party action");
      const caller = room.remoteParticipants.get(callerIdentity);
      await apply(action, caller?.name || callerIdentity.split("#")[0]!);
      return "";
    });
    return () => {
      room.unregisterRpcMethod(RPC_CLOCK);
      room.unregisterRpcMethod(RPC_ACTION);
    };
  }, [room, apply]);

  // NTP-style: a few round trips to the host, keeping the one with the shortest RTT.
  useEffect(() => {
    if (!hostIdentity) return;
    let cancelled = false;
    void (async () => {
      let best: { rtt: number; offset: number } | null = null;
      for (let i = 0; i < 4 && !cancelled; i++) {
        try {
          const sent = Date.now();
          const reply = Number(await local.performRpc({ destinationIdentity: hostIdentity, method: RPC_CLOCK, payload: "" }));
          const received = Date.now();
          if (Number.isFinite(reply) && (!best || received - sent < best.rtt))
            best = { rtt: received - sent, offset: reply - (sent + received) / 2 };
        } catch {
          // Host busy or gone: fewer samples.
        }
      }
      if (!cancelled && best) setClock({ host: hostIdentity, offset: best.offset });
    })();
    return () => {
      cancelled = true;
    };
  }, [local, hostIdentity]);

  // Lost a start race (two people started at once): drop ours and follow the winner.
  const ownRaw = local.attributes[ATTRIBUTE];
  useEffect(() => {
    if (ownRaw && party && party.host !== local) void publish(null).catch(() => undefined);
  }, [ownRaw, party, local, publish]);

  // Host left: everyone runs the same election, so exactly one participant adopts the state.
  useEffect(() => {
    const onLeft = (participant: RemoteParticipant) => {
      const { party, offset } = latest.current;
      if (party?.host.identity !== participant.identity) return;
      const [heir] = [room.localParticipant, ...room.remoteParticipants.values()].sort(byJoinOrder);
      if (heir !== room.localParticipant) return;
      const { state } = party;
      const now = Date.now();
      void publish({ ...state, position: positionAt(state, now + offset), at: now, rev: state.rev + 1 }).catch(
        () => undefined,
      );
    };
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
    };
  }, [room, publish]);

  const hostNow = useCallback(() => Date.now() + latest.current.offset, []);
  return { party, isHost, hostNow, dispatch };
}
