import type { RemoteTrackPublication, Track } from "livekit-client";
import { useEffect, useSyncExternalStore } from "react";
import type { TileModel } from "./model";

/**
 * "Janela flutuante": someone else's screen or camera in the browser's picture-in-picture window, to keep
 * an eye on it from another app. The window shows a <video> of its own, outside the tiles, so pinning or
 * rearranging the stage (which remounts tiles) doesn't close it. Only the picture goes there: the sound
 * keeps playing from RoomAudio, at the volume picked in the room. LiveKit's adaptive stream counts a video
 * in picture-in-picture as visible, so it keeps arriving while the tab is in the background.
 */

/** No API in Firefox; false too where the page's permissions policy blocks it. */
export const pipSupported = typeof document !== "undefined" && document.pictureInPictureEnabled === true;

/** Longest wait for the first frame before giving up on opening the window. */
const FIRST_FRAME_TIMEOUT = 5000;

/** The video a tile can float: someone else's screen while you watch it, or their camera while it's on. */
export function floatableTrack(tile: TileModel): Track | undefined {
  if (tile.participant.isLocal) return undefined;
  if (tile.kind === "camera") return tile.camera && !tile.camera.isMuted ? tile.camera.track : undefined;
  // After "Parar de assistir" the track lingers until the unsubscription goes through.
  return (tile.video as RemoteTrackPublication).isDesired ? tile.video.track : undefined;
}

interface Floating {
  tileId: string;
  track: Track;
  video: HTMLVideoElement;
}

let floating: Floating | null = null;
const listeners = new Set<() => void>();
let reportError: ((err: unknown) => void) | null = null;

function setFloating(next: Floating | null) {
  floating = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Off-screen but laid out: adaptive stream picks the resolution from the element's size, kept at the window's. */
function createVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, { position: "fixed", top: "0", left: "-100vw", width: "480px", height: "270px", pointerEvents: "none" });
  video.addEventListener("leavepictureinpicture", closePip);
  document.body.append(video);
  return video;
}

function firstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    setTimeout(() => reject(new Error("o vídeo não começou a chegar")), FIRST_FRAME_TIMEOUT);
  });
}

/** Floats a tile's video, or moves the open window over to it. Call it from a click: browsers only open the window on one. */
export async function openPip(tileId: string, track: Track) {
  const video = floating?.video ?? createVideo();
  floating?.track.detach(video);
  track.attach(video);
  setFloating({ tileId, track, video });
  if (document.pictureInPictureElement === video) return;
  try {
    await firstFrame(video);
    if (floating?.video !== video) return; // closed while waiting
    const win = await video.requestPictureInPicture();
    const fit = () => Object.assign(video.style, { width: `${win.width}px`, height: `${win.height}px` });
    fit();
    win.addEventListener("resize", fit);
  } catch (err) {
    if (floating?.video !== video) return;
    closePip();
    reportError?.(err);
  }
}

export function closePip() {
  if (!floating) return;
  const { track, video } = floating;
  setFloating(null);
  if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
  track.detach(video);
  video.remove();
}

/** Id of the tile in the floating window, if any. */
export function usePipTile(): string | null {
  return useSyncExternalStore(subscribe, () => floating?.tileId ?? null);
}

/**
 * Keeps the window on its tile: follows its track if it's replaced, and closes it once there's nothing left
 * to float (screen stopped, "Parar de assistir", camera off, they left) or when leaving the room.
 */
export function usePipWindow(tiles: TileModel[], onError: (err: unknown) => void) {
  useEffect(() => {
    reportError = onError;
  });
  useEffect(() => {
    if (!floating) return;
    const tile = tiles.find((t) => t.id === floating!.tileId);
    const track = tile && floatableTrack(tile);
    if (!track) closePip();
    else if (track !== floating.track) void openPip(tile.id, track);
  });
  useEffect(
    () => () => {
      reportError = null;
      closePip();
    },
    [],
  );
}
