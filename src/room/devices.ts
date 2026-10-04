import type { RoomOptions } from "livekit-client";
import type { ScreenPrefs } from "./model";

export type DeviceKind = "audioinput" | "videoinput" | "audiooutput";

const deviceKey = (kind: DeviceKind) => `hypemeet:device:${kind}`;
const SCREEN_MODE_KEY = "hypemeet:screen-mode";
const SCREEN_AUDIO_KEY = "hypemeet:screen-audio";

export function saveDevice(kind: DeviceKind, deviceId: string) {
 localStorage.setItem(deviceKey(kind), deviceId);
}

/**
 * Room options that start on the devices picked last time. Plain (non-exact) deviceIds act as a
 * preference, so an unplugged headset silently falls back to the system default.
 */
export function deviceRoomOptions(): Pick<RoomOptions, "audioCaptureDefaults" | "videoCaptureDefaults" | "audioOutput"> {
 const mic = localStorage.getItem(deviceKey("audioinput"));
 const camera = localStorage.getItem(deviceKey("videoinput"));
 const speaker = localStorage.getItem(deviceKey("audiooutput"));
 return {
  ...(mic ? { audioCaptureDefaults: { deviceId: mic } } : {}),
  ...(camera ? { videoCaptureDefaults: { deviceId: camera } } : {}),
  ...(speaker ? { audioOutput: { deviceId: speaker } } : {}),
 };
}

/** Output switching needs AudioContext.setSinkId (Chromium) because the room mixes via Web Audio. */
export const canPickSpeaker = typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

/** Defaults: motion mode, audio on. */
export function loadScreenPrefs(): ScreenPrefs {
 return {
  mode: localStorage.getItem(SCREEN_MODE_KEY) === "detail" ? "detail" : "motion",
  audio: localStorage.getItem(SCREEN_AUDIO_KEY) !== "off",
 };
}

export function saveScreenPrefs(prefs: ScreenPrefs) {
 localStorage.setItem(SCREEN_MODE_KEY, prefs.mode);
 localStorage.setItem(SCREEN_AUDIO_KEY, prefs.audio ? "on" : "off");
}
