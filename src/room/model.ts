import {
 AudioPresets,
 RoomEvent,
 Track,
 type LocalParticipant,
 type LocalTrackPublication,
 type Participant,
 type Room,
 type TrackPublication,
} from "livekit-client";
import { useEffect, useReducer } from "react";

/**
 * Every screen share is published as a pair:
 *   video  → name "screen:<ts>-<id>",       source ScreenShare
 *   audio  → name "screen:<ts>-<id>:audio", source ScreenShareAudio (only if the user shared audio)
 * LiveKit allows several publications per source, so a participant can share N screens at once;
 * the name is what ties a screen's audio to its video on the receiving side.
 */
const SCREEN_PREFIX = "screen:";
const AUDIO_SUFFIX = ":audio";

export type TileModel =
 | { kind: "camera"; id: string; participant: Participant }
 | {
  kind: "screen";
  id: string;
  participant: Participant;
  video: TrackPublication;
  audio?: TrackPublication;
  /** 1-based position among this participant's screens; null when they share only one. */
  number: number | null;
 };

/** Screens first (they're what people came for), then cameras; local participant first in each group. */
export function buildTiles(room: Room): TileModel[] {
 const screens: TileModel[] = [];
 const cameras: TileModel[] = [];
 for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
  cameras.push({ kind: "camera", id: `${participant.identity}:camera`, participant });
  const pubs = [...participant.trackPublications.values()];
  // Names embed a base36 timestamp, so sorting by name = order they were started (same for everyone).
  const videos = pubs
   .filter((p) => p.source === Track.Source.ScreenShare)
   .sort((a, b) => a.trackName.localeCompare(b.trackName));
  videos.forEach((video, i) => {
   const audio = pubs.find(
    (p) => p.source === Track.Source.ScreenShareAudio && p.trackName === video.trackName + AUDIO_SUFFIX,
   );
   const number = videos.length > 1 ? i + 1 : null;
   screens.push({ kind: "screen", id: video.trackSid, participant, video, audio, number });
  });
 }
 return [...screens, ...cameras];
}

/**
 * Key under which a listener's local volume preference is stored. Mic volume follows the person;
 * screen-audio volume follows that specific screen.
 */
export function volumeKey(participant: Participant, pub: TrackPublication): string {
 return pub.source === Track.Source.Microphone ? `mic:${participant.identity}` : `track:${pub.trackSid}`;
}

/**
 * motion: games/video — 60 fps; under bandwidth pressure the encoder drops resolution, not frames.
 * detail: text/code/slides — keeps every pixel sharp and drops frames instead.
 */
export type ScreenMode = "motion" | "detail";

const SCREEN_MODES = {
 motion: { frameRate: 60, maxBitrate: 6_000_000, contentHint: "motion", degradation: "maintain-framerate" },
 detail: { frameRate: 30, maxBitrate: 4_000_000, contentHint: "detail", degradation: "maintain-resolution" },
} as const satisfies Record<
 ScreenMode,
 { frameRate: number; maxBitrate: number; contentHint: "motion" | "detail"; degradation: RTCDegradationPreference }
>;

/** Chromium-only getDisplayMedia hints that lib.dom doesn't type yet. */
interface ScreenCaptureOptions extends DisplayMediaStreamOptions {
 audio:
 | false
 | (MediaTrackConstraints & {
  /** Chrome 141+: drop this tab's own playout (everyone else in the room) from system audio. */
  restrictOwnAudio?: boolean;
 });
 systemAudio: "include" | "exclude";
 /** Chrome 141+ on Windows: when a window is picked, offer just that app's audio instead of the whole PC. */
 windowAudio: "window" | "system" | "exclude";
 selfBrowserSurface: "include" | "exclude";
 surfaceSwitching: "include" | "exclude";
}

/** What a new screen share starts with; remembered between sessions. */
export interface ScreenPrefs {
 mode: ScreenMode;
 /** Ask the picker for audio. The browser may still hand back none (see README). */
 audio: boolean;
}

/**
 * Opens the browser picker and publishes the chosen surface. Resolves to whether audio is being
 * sent — false when it wasn't requested or the user/browser didn't provide it.
 */
export async function startScreenShare(participant: LocalParticipant, prefs: ScreenPrefs): Promise<boolean> {
 const preset = SCREEN_MODES[prefs.mode];
 // Fixed-width base36 ms timestamp (8 chars until year 2059) + random suffix for uniqueness.
 const name = `${SCREEN_PREFIX}${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`;
 // Called directly instead of createScreenTracks(): LiveKit drops unknown options like windowAudio.
 const options: ScreenCaptureOptions = {
  video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: preset.frameRate },
  // Raw audio: voice processing would wreck music/game audio.
  audio: prefs.audio
   ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true }
   : false,
  systemAudio: prefs.audio ? "include" : "exclude",
  windowAudio: prefs.audio ? "window" : "exclude",
  selfBrowserSurface: "exclude",
  surfaceSwitching: "include",
 };
 const stream = await navigator.mediaDevices.getDisplayMedia(options);
 const [video] = stream.getVideoTracks();
 if (!video) {
  for (const track of stream.getTracks()) track.stop();
  throw new DOMException("no video track", "NotFoundError");
 }
 video.contentHint = preset.contentHint;
 // Video first so receivers always see the screen before (or with) its audio.
 const tracks = [video, ...stream.getAudioTracks().slice(0, 1)];
 try {
  for (const track of tracks) {
   if (track.kind === Track.Kind.Video) {
    await participant.publishTrack(track, {
     name,
     source: Track.Source.ScreenShare,
     // LiveKit ignores videoEncoding for ScreenShare sources; it reads screenShareEncoding.
     screenShareEncoding: { maxBitrate: preset.maxBitrate, maxFramerate: preset.frameRate },
     degradationPreference: preset.degradation,
    });
   } else {
    await participant.publishTrack(track, {
     name: name + AUDIO_SUFFIX,
     source: Track.Source.ScreenShareAudio,
     audioPreset: AudioPresets.musicHighQualityStereo,
     dtx: false,
     red: false,
    });
   }
  }
 } catch (err) {
  for (const track of tracks) {
   await participant.unpublishTrack(track).catch(() => undefined);
   track.stop();
  }
  throw err;
 }
 return tracks.length > 1;
}

/** A live screen's current mode, read back from its capture track (set at start or by changeScreenMode). */
export function screenModeOf(pub: TrackPublication): ScreenMode {
 return pub.track?.mediaStreamTrack.contentHint === "detail" ? "detail" : "motion";
}

/**
 * Switches a live screen between modes without re-opening the picker: capture frame rate, encoder
 * content hint, degradation policy and the top layer's bitrate/frame-rate caps.
 */
export async function changeScreenMode(pub: LocalTrackPublication, mode: ScreenMode) {
 const track = pub.videoTrack;
 if (!track) return;
 const preset = SCREEN_MODES[mode];
 const media = track.mediaStreamTrack;
 media.contentHint = preset.contentHint;
 await media.applyConstraints({ ...media.getConstraints(), frameRate: preset.frameRate });
 await track.setDegradationPreference(preset.degradation);
 const sender = track.sender;
 if (!sender) return;
 const params = sender.getParameters();
 // Simulcast may add a low layer; only the full-quality one carries the mode's caps.
 const top = params.encodings.reduce<RTCRtpEncodingParameters | undefined>(
  (best, enc) => (!best || (enc.maxBitrate ?? 0) > (best.maxBitrate ?? 0) ? enc : best),
  undefined,
 );
 if (!top) return;
 top.maxBitrate = preset.maxBitrate;
 top.maxFramerate = preset.frameRate;
 await sender.setParameters(params);
}

/**
 * "Áudio do PC": any audio input (typically a virtual cable the user routes chosen apps into) sent as
 * raw stereo music audio. One per participant, attached to the person rather than to a screen.
 */
const DEVICE_AUDIO_NAME = "device-audio";

export function deviceAudioPublication(participant: Participant): TrackPublication | undefined {
 return participant.getTrackPublicationByName(DEVICE_AUDIO_NAME);
}

/** Starts streaming `deviceId`, replacing the current one. The old stream keeps going if the new one fails to open. */
export async function startDeviceAudio(participant: LocalParticipant, deviceId: string): Promise<void> {
 const stream = await navigator.mediaDevices.getUserMedia({
  // Raw stereo: voice processing would wreck music/game audio.
  audio: {
   deviceId: { exact: deviceId },
   echoCancellation: false,
   noiseSuppression: false,
   autoGainControl: false,
   channelCount: { ideal: 2 },
  },
 });
 const [track] = stream.getAudioTracks();
 await stopDeviceAudio(participant);
 try {
  await participant.publishTrack(track, {
   name: DEVICE_AUDIO_NAME,
   // Screen-audio semantics: unpublished if the device disappears, never treated as the mic.
   source: Track.Source.ScreenShareAudio,
   audioPreset: AudioPresets.musicHighQualityStereo,
   dtx: false,
   red: false,
  });
 } catch (err) {
  track.stop();
  throw err;
 }
}

export async function stopDeviceAudio(participant: LocalParticipant): Promise<void> {
 const track = participant.getTrackPublicationByName(DEVICE_AUDIO_NAME)?.track;
 if (track) await participant.unpublishTrack(track);
}

/**
 * When a screen's video goes away (our stop button, or the browser's own "Stop sharing" bar, which
 * the SDK turns into an unpublish), drop its paired audio too.
 */
export function useScreenAudioCleanup(room: Room) {
 useEffect(() => {
  const onUnpublished = (pub: LocalTrackPublication, participant: LocalParticipant) => {
   if (pub.source !== Track.Source.ScreenShare) return;
   for (const audio of participant.trackPublications.values()) {
    if (audio.trackName === pub.trackName + AUDIO_SUFFIX && audio.track) {
     void participant.unpublishTrack(audio.track);
    }
   }
  };
  room.on(RoomEvent.LocalTrackUnpublished, onUnpublished);
  return () => {
   room.off(RoomEvent.LocalTrackUnpublished, onUnpublished);
  };
 }, [room]);
}

const RERENDER_EVENTS = [
 RoomEvent.ConnectionStateChanged,
 RoomEvent.ParticipantConnected,
 RoomEvent.ParticipantDisconnected,
 RoomEvent.ParticipantNameChanged,
 RoomEvent.TrackPublished,
 RoomEvent.TrackUnpublished,
 RoomEvent.TrackSubscribed,
 RoomEvent.TrackUnsubscribed,
 RoomEvent.TrackMuted,
 RoomEvent.TrackUnmuted,
 RoomEvent.LocalTrackPublished,
 RoomEvent.LocalTrackUnpublished,
 RoomEvent.ActiveSpeakersChanged,
 RoomEvent.AudioPlaybackStatusChanged,
 RoomEvent.Reconnecting,
 RoomEvent.Reconnected,
 RoomEvent.ActiveDeviceChanged,
 RoomEvent.MediaDevicesChanged,
] as const;

/** LiveKit state is mutable; re-render whenever anything we display may have changed. */
export function useRoomVersion(room: Room): number {
 const [version, bump] = useReducer((n: number) => n + 1, 0);
 useEffect(() => {
  for (const event of RERENDER_EVENTS) room.on(event, bump);
  return () => {
   for (const event of RERENDER_EVENTS) room.off(event, bump);
  };
 }, [room]);
 return version;
}
