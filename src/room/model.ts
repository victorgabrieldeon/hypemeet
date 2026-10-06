import {
 AudioPresets,
 RoomEvent,
 Track,
 type LocalParticipant,
 type LocalTrackPublication,
 type Participant,
 type RemoteParticipant,
 type RemoteTrackPublication,
 type Room,
 type TrackPublication,
} from "livekit-client";
import { useEffect, useReducer } from "react";
import { detectOS, IS_DESKTOP_APP } from "../lib/downloads";

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

/** The desktop app's per-app screen audio (Linux, PipeWire; see desktop/app-audio.js). Absent elsewhere. */
interface DesktopScreenAudio {
 /** Right after getDisplayMedia: the label of the mic carrying the picked app's audio, or null. */
 claim(): Promise<string | null>;
 release(): void;
}
const desktopScreenAudio = (window as { desktopScreenAudio?: DesktopScreenAudio }).desktopScreenAudio;

/**
 * Where screen audio is switched on and what it captures differ between a browser tab (tab audio
 * only on Linux/macOS) and the desktop app (a single app/tab on Linux, else whole-system loopback;
 * older Linux builds include the call).
 */
export const SCREEN_AUDIO_COPY = IS_DESKTOP_APP
 ? desktopScreenAudio && detectOS() === "linux"
  ? {
   hint: "Uma aba, um app ou o PC todo: você escolhe no seletor.",
   missing: "Tela compartilhada sem som. Pra mandar áudio, escolha o app ou a aba no campo “Áudio” do seletor.",
   tooltip: "Essa tela foi compartilhada sem áudio. Pra ter som, comece uma nova escolhendo o app no campo “Áudio”.",
  }
  : {
   hint:
    detectOS() === "linux"
     ? "Todo o som do PC, inclusive o desta chamada (eco)."
     : "Todo o som do PC, menos o desta chamada.",
   missing: "Tela compartilhada sem som. Pra mandar áudio, ative “Compartilhar o áudio do sistema” ao escolher a tela.",
   tooltip: "Essa tela foi compartilhada sem áudio. Pra ter som, comece uma nova ativando “Compartilhar o áudio do sistema”.",
  }
 : {
  hint: "No Linux/macOS, só compartilhando uma aba.",
  missing:
   "Tela compartilhada sem som. Pra mandar áudio, marque “Compartilhar áudio” no seletor (no Linux/macOS só funciona compartilhando uma aba).",
  tooltip: "Essa tela foi compartilhada sem áudio. Pra ter som, comece uma nova marcando “Compartilhar áudio” no seletor.",
 };

/** The screen (video track name) whose audio is the desktop app's virtual mic: there's one, so one at a time. */
let appAudioScreen: string | null = null;

function releaseAppAudio() {
 if (!appAudioScreen) return;
 appAudioScreen = null;
 desktopScreenAudio?.release();
}

/**
 * The desktop app routed one app's (or tab's) playback into a virtual mic instead of handing
 * getDisplayMedia an audio track: record that mic. Null when it didn't.
 */
async function openAppAudio(): Promise<MediaStreamTrack | null> {
 const label = await desktopScreenAudio?.claim();
 if (!label) return null;
 try {
  // PipeWire publishes the new mic asynchronously; give it a moment to show up.
  for (let attempt = 0; attempt < 10; attempt++) {
   const devices = await navigator.mediaDevices.enumerateDevices();
   const device = devices.find((d) => d.kind === "audioinput" && d.label === label);
   if (device) {
    const stream = await navigator.mediaDevices.getUserMedia({
     // Raw audio, like the getDisplayMedia path.
     audio: {
      deviceId: { exact: device.deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48000,
     },
    });
    return stream.getAudioTracks()[0] ?? null;
   }
   await new Promise((resolve) => setTimeout(resolve, 200));
  }
 } catch (err) {
  console.warn("app audio unavailable:", err);
 }
 desktopScreenAudio?.release();
 return null;
}

/** Whether a mic is the desktop app's screen-audio mic, which isn't for talking. */
export const isScreenAudioDevice = (device: MediaDeviceInfo) => device.label === "vencord-screen-share";

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
 const appAudio = await openAppAudio();
 if (appAudio) appAudioScreen = name;
 // Video first so receivers always see the screen before (or with) its audio.
 const tracks = [video, ...(appAudio ? [appAudio] : stream.getAudioTracks().slice(0, 1))];
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
  if (appAudioScreen === name) releaseAppAudio();
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
 * When a screen's video goes away (our stop button, or the browser's own "Stop sharing" bar, which
 * the SDK turns into an unpublish), drop its paired audio too, and free the desktop app's
 * per-app audio if that's where it came from.
 */
export function useScreenAudioCleanup(room: Room) {
 useEffect(() => {
  const onUnpublished = (pub: LocalTrackPublication, participant: LocalParticipant) => {
   if (appAudioScreen && (pub.trackName === appAudioScreen || pub.trackName === appAudioScreen + AUDIO_SUFFIX)) {
    releaseAppAudio();
   }
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
   // Leaving the room ends every screen.
   releaseAppAudio();
  };
 }, [room]);
}

/**
 * The room connects with autoSubscribe off: mics and cameras are subscribed here as they appear,
 * while a screen (video + paired audio) only streams once the listener chooses to watch it.
 */
export function useSubscriptions(room: Room) {
 useEffect(() => {
  const onPublished = (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
   if (pub.source === Track.Source.ScreenShare) return;
   if (pub.source === Track.Source.ScreenShareAudio) {
    // Audio is published right after its video: follow whatever the listener chose for that screen.
    const video = [...participant.trackPublications.values()].find(
     (v) => v.source === Track.Source.ScreenShare && pub.trackName === v.trackName + AUDIO_SUFFIX,
    );
    if (video?.isDesired) pub.setSubscribed(true);
    return;
   }
   pub.setSubscribed(true);
  };
  for (const participant of room.remoteParticipants.values())
   for (const pub of participant.trackPublications.values()) onPublished(pub, participant);
  room.on(RoomEvent.TrackPublished, onPublished);
  return () => {
   room.off(RoomEvent.TrackPublished, onPublished);
  };
 }, [room]);
}

/** Starts or stops receiving a remote screen, its audio included. */
export function watchScreen(tile: Extract<TileModel, { kind: "screen" }>, watch: boolean) {
 (tile.video as RemoteTrackPublication).setSubscribed(watch);
 (tile.audio as RemoteTrackPublication | undefined)?.setSubscribed(watch);
}

const RERENDER_EVENTS = [
 RoomEvent.ConnectionStateChanged,
 RoomEvent.ParticipantConnected,
 RoomEvent.ParticipantDisconnected,
 RoomEvent.ParticipantNameChanged,
 RoomEvent.ParticipantAttributesChanged,
 RoomEvent.TrackPublished,
 RoomEvent.TrackUnpublished,
 RoomEvent.TrackSubscribed,
 RoomEvent.TrackUnsubscribed,
 RoomEvent.TrackSubscriptionStatusChanged,
 RoomEvent.TrackMuted,
 RoomEvent.TrackUnmuted,
 RoomEvent.LocalTrackPublished,
 RoomEvent.LocalTrackUnpublished,
 RoomEvent.ActiveSpeakersChanged,
 RoomEvent.ConnectionQualityChanged,
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
