import { DisconnectReason, RoomEvent, Track, type Room, type TrackPublication } from "livekit-client";
import { useEffect } from "react";
import { canPickSpeaker, loadDevice } from "./devices";

/** Each cue is a short run of notes: [frequency Hz, start offset s, duration s]. */
const CUES = {
 join: [
  [659.25, 0, 0.12],
  [880, 0.09, 0.2],
 ],
 leave: [
  [880, 0, 0.12],
  [587.33, 0.09, 0.22],
 ],
 mute: [[392, 0, 0.09]],
 unmute: [[587.33, 0, 0.09]],
 screenStart: [
  [523.25, 0, 0.1],
  [659.25, 0.07, 0.1],
  [987.77, 0.14, 0.2],
 ],
 screenStop: [
  [783.99, 0, 0.1],
  [523.25, 0.08, 0.18],
 ],
} satisfies Record<string, [number, number, number][]>;

export type Cue = keyof typeof CUES;

const VOLUME = 0.12;

/** lib.dom doesn't type AudioContext.setSinkId yet (Chromium-only, gated by canPickSpeaker). */
let ctx: (AudioContext & { setSinkId(sinkId: string): Promise<void> }) | null = null;
let sink = "";

/**
 * Synthesised rather than shipped as files: no assets to load, plays instantly. Goes to the speaker
 * picked in the device menu, like the call audio.
 */
export function playCue(cue: Cue) {
 ctx ??= new AudioContext() as NonNullable<typeof ctx>;
 const speaker = canPickSpeaker ? (loadDevice("audiooutput") ?? "") : "";
 if (speaker !== sink) {
  sink = speaker;
  // An unplugged speaker just leaves the cue on the system default.
  void ctx.setSinkId(speaker).catch(() => { });
 }
 void ctx.resume();
 const start = ctx.currentTime + 0.01;
 for (const [freq, offset, duration] of CUES[cue]) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = start + offset;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(VOLUME, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
 }
}

/**
 * Cues for things happening in the room: people joining/leaving, screens starting/stopping (ours and
 * others'), and the connection dropping. Our own join, leave button and mic toggles are cued by
 * whoever triggers them.
 */
export function useRoomSounds(room: Room) {
 useEffect(() => {
  const joined = () => playCue("join");
  const left = () => playCue("leave");
  const published = (pub: TrackPublication) => pub.source === Track.Source.ScreenShare && playCue("screenStart");
  const unpublished = (pub: TrackPublication) => pub.source === Track.Source.ScreenShare && playCue("screenStop");
  const disconnected = (reason?: DisconnectReason) => reason !== DisconnectReason.CLIENT_INITIATED && playCue("leave");
  room
   .on(RoomEvent.ParticipantConnected, joined)
   .on(RoomEvent.ParticipantDisconnected, left)
   .on(RoomEvent.TrackPublished, published)
   .on(RoomEvent.LocalTrackPublished, published)
   .on(RoomEvent.TrackUnpublished, unpublished)
   .on(RoomEvent.LocalTrackUnpublished, unpublished)
   .on(RoomEvent.Disconnected, disconnected);
  return () => {
   room
    .off(RoomEvent.ParticipantConnected, joined)
    .off(RoomEvent.ParticipantDisconnected, left)
    .off(RoomEvent.TrackPublished, published)
    .off(RoomEvent.LocalTrackPublished, published)
    .off(RoomEvent.TrackUnpublished, unpublished)
    .off(RoomEvent.LocalTrackUnpublished, unpublished)
    .off(RoomEvent.Disconnected, disconnected);
  };
 }, [room]);
}
