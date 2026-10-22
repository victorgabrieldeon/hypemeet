import { RoomEvent, Track, type LocalParticipant, type Participant, type RemoteParticipant, type Room } from "livekit-client";

/**
 * Transmitters: the Discord Activity can't capture the screen or the camera, so it opens a link in the
 * browser (/transmitir, see CastPage) that joins the room as a second connection carrying only those. The
 * server stamps it with the identity of whoever asked (attribute `castFor`, mirrored in server/index.ts):
 * everyone shows its screens and camera under that person's name and leaves the transmitter itself out of the
 * people (tiles, count, sounds, elections). The owner controls it over the `cast` topic.
 */
const CAST_FOR = "castFor";
const TOPIC = "cast";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Identity of the person this connection transmits for; null for people. */
export const castOwnerOf = (participant: Participant): string | null => participant.attributes[CAST_FOR] || null;

export const isTransmitter = (participant: Participant) => castOwnerOf(participant) !== null;

/** The room's people: remote participants minus transmitters. */
export const remotePeople = (room: Room): RemoteParticipant[] =>
  [...room.remoteParticipants.values()].filter((p) => !isTransmitter(p));

/** Owner → transmitter: stop one screen or the camera (by video track sid), or all the screens. */
export function stopCast(local: LocalParticipant, transmitter: Participant, screen: string | "all") {
  return local.publishData(encoder.encode(JSON.stringify({ stop: screen })), {
    reliable: true,
    topic: TOPIC,
    destinationIdentities: [transmitter.identity],
  });
}

/** Transmitter side: carries out the owner's stops. Only the owner is obeyed. Returns the unsubscribe. */
export function obeyOwner(room: Room, owner: string): () => void {
  const onData = (payload: Uint8Array, from?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (topic !== TOPIC || from?.identity !== owner) return;
    let stop: unknown;
    try {
      stop = (JSON.parse(decoder.decode(payload)) as { stop?: unknown }).stop;
    } catch {
      return;
    }
    const local = room.localParticipant;
    // Paired audio goes with its video (useScreenAudioCleanup).
    for (const pub of local.trackPublications.values())
      if (pub.track && (stop === pub.trackSid || (stop === "all" && pub.source === Track.Source.ScreenShare)))
        void local.unpublishTrack(pub.track);
  };
  room.on(RoomEvent.DataReceived, onData);
  return () => void room.off(RoomEvent.DataReceived, onData);
}
